import "server-only";
import type { RealtimeClient } from "@stream-io/openai-realtime-api";

import {
    agentReplySeverity,
    checkAgentReply,
    isSoleContentSafetyBlock,
    checkUserInput,
    incrementBlockedTurns,
    isVnPolicyResult,
    recordGuardTurn,
    recordSafetyEvent,
    recordUserInputEvents,
    setGuardTurnResponseStart,
    severityOf,
    type GuardResult,
} from "@/lib/safety-events";
import { VN_CORRECTION_NOTE } from "@/lib/vn-policy";
import {
    FINAL_WARNING_NOTE,
    KILL_NOTE,
    maxSeverity,
    REFUSAL_NOTE,
    SAFETY_KILL_AT,
    SAFETY_WARN_AT,
    SUPPORT_NOTE,
    SUPPORT_RETRY_NOTE,
    WARNING_NOTE,
    type Severity,
} from "@/lib/safety-policy";

// Sentence boundaries used to chunk the agent transcript (also covers Vietnamese punctuation usage)
const SENTENCE_END = /[.!?…]\s*$/;
const MIN_CHUNK_LENGTH = 40;
// The call is ended after the closing line is spoken, or after this long if it never completes
const KILL_FALLBACK_MS = 15_000;
// Ending the call is retried: a failed call.end() left the call running after the kill-switch
const END_CALL_ATTEMPTS = 3;
// How long an agent reply check waits for the transcript / verdict of the user turn it answers
const TURN_WAIT_MS = 5_000;
const TURN_VERDICT_WAIT_MS = 30_000;
// A content-safety block on a reply waits this long for the user turn's verdict before acting on it
// (agentReplySeverity needs it to tell a refusal or a supportive reply from harmful content)
const AGENT_ACTION_WAIT_MS = 2_000;
// Fragments of one spoken sentence (server VAD still splits at pauses) are checked and counted as
// one utterance when a fragment starts this soon after the previous one ended
const UTTERANCE_GAP_MS = 2_500;
// Strict mode: longest the agent waits for the guard before answering anyway (A2 survey)
const STRICT_TIMEOUT_MS = Number(process.env.GUARD_STRICT_TIMEOUT_MS ?? 2000);

export type GuardMode = "shadow" | "strict";
type TurnDecision = "shadow" | "safe" | "care" | "block" | "timeout";

/** One user utterance, from the end of speech to the agent's first words. */
interface Turn {
    // Order of the user's utterances; a response answers every utterance committed before it
    seq: number;
    speechStoppedAt: number | null;
    responseStartMs: number | null;
    rowId: Promise<string | null> | null;
    speechStartedAt: number | null;
    // The utterance text (null when empty or failed) and its verdict, as soon as they are known
    text: Promise<string | null>;
    verdict: Promise<Severity | null>;
    // undefined until the verdict is known
    severity: Severity | null | undefined;
    setText: (text: string | null) => void;
    setVerdict: (severity: Severity | null) => void;
}

function createTurn(seq: number, speechStoppedAt: number | null, speechStartedAt: number | null = null): Turn {
    let setText!: (text: string | null) => void;
    let setVerdict!: (severity: Severity | null) => void;
    const text = new Promise<string | null>((resolve) => { setText = resolve; });
    const verdict = new Promise<Severity | null>((resolve) => { setVerdict = resolve; });
    return { seq, speechStoppedAt, speechStartedAt, responseStartMs: null, rowId: null, text, verdict, severity: undefined, setText, setVerdict };
}

/** Resolves to the promise's value, or to `fallback` after `ms` (a turn whose transcript never comes). */
const within = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
    Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

interface ResponseState {
    // The user turn this response answers (the latest one when it was created)
    turn: Turn | null;
    text: string;
    checkedLength: number;
    checking: boolean;
    active: boolean;
    transcriptDone: boolean;
    isRefusal: boolean;
    // The kill-switch closing line; the call ends when it is done
    isClosing: boolean;
    // A reply to a self-harm disclosure whose opening was blocked: acted on only if the block holds
    // on more of the reply
    careBlockDeferred: boolean;
}

/**
 * Guard for the OpenAI Realtime agent. Verdicts are acted on by policy tier
 * (src/lib/safety-policy.ts): "block" makes the agent refuse, "care" switches the session to a
 * supportive mode once, "log" only records. Blocked user turns escalate: a warning, a final
 * warning, then the kill-switch ends the call.
 *
 * - shadow: the agent answers at once and the guard classifies in parallel; a "block" verdict
 *   cancels the in-flight response.
 * - strict: the session does not answer by itself (`create_response: false`). Each user turn is
 *   checked first: the first "block" verdict refuses at once, a cleared turn is answered, and after
 *   STRICT_TIMEOUT_MS the agent answers anyway while the guard goes on as in shadow mode.
 * Agent replies are checked in parallel in both modes (they are not known in advance).
 */
export function attachRealtimeGuard(
    client: RealtimeClient,
    {
        meetingId,
        instructions,
        endCall,
        mode,
        supportMode: startInSupportMode = false,
    }: {
        meetingId: string;
        instructions: string;
        endCall: () => Promise<unknown>;
        mode: GuardMode;
        // A reconnected session resumes the supportive mode the call was already in
        supportMode?: boolean;
    }
) {
    const responses = new Map<string, ResponseState>();
    let activeResponseId: string | null = null;
    let lastUserText = "";
    let pendingRefusal = false;
    let refusalQueued = false;
    // A response.create was sent and its response.created has not arrived yet
    let responseRequested = false;
    // Strict: a cleared turn waits for the agent to finish its current response
    let releaseQueued = false;
    // Strict: server VAD often splits one sentence at a pause, so a turn is not answered while the
    // user is already speaking again; the answer is owed to the next turn instead
    let userSpeaking = false;
    let answerOwed = false;
    let currentTurn: Turn | null = null;
    let turnSeq = 0;
    let speechStartedAt: number | null = null;
    // The utterance being spoken: its fragments so far, when the last one ended, whether its block
    // was already counted for the kill-switch
    let utterance: { texts: string[]; endedAt: number; counted: boolean } | null = null;
    // Latest utterance a response has already covered: fragments of one sentence that are cleared
    // together (e.g. after a slow guard) must not get one answer each
    let answeredSeq = 0;
    // Guard notes are appended to the agent's instructions instead of replacing them
    let sessionInstructions = startInSupportMode ? `${instructions}\n\n${SUPPORT_NOTE}` : instructions;
    let refusalNote = REFUSAL_NOTE;
    let supportMode = startInSupportMode;
    // Fallback count when the DB write fails; the DB total survives guard restarts
    let blockedTurns = 0;
    let killed = false;
    let callEnded = false;

    const describe = (result: GuardResult) => {
        if (isVnPolicyResult(result)) {
            const verdict = result.violation ? "VIOLATION" : result.unverified ? "unverified" : "ok";
            return `vn_policy=${verdict}${result.type ? `(${result.type})` : ""}`;
        }
        if ("jailbreak" in result) {
            return `${result.detector}=${result.jailbreak ? "JAILBREAK" : "ok"}${result.technique ? `(${result.technique})` : ""}`;
        }
        // Nemotron returns one category list for the whole exchange, so show both verdicts
        return `content_safety=user:${result.userSafe ? "safe" : "UNSAFE"}` +
            (result.responseSafe === null ? "" : `,agent:${result.responseSafe ? "safe" : "UNSAFE"}`) +
            `[${result.categories.join(", ")}]`;
    };

    const log = (message: string, results: GuardResult[] = []) => {
        const details = results
            .map((result) => {
                const verdict = describe(result);
                return ` ${verdict} ${result.latencyMs}ms${result.error ? ` error=${result.error}` : ""}`;
            })
            .join(" |");
        console.log(`[guard][${meetingId}] ${message}${details}`);
    };

    // Timers (strict timeout, kill fallback) can fire after the connection dropped, and the client
    // throws when sending without one
    const send = (eventName: string, data: Record<string, unknown> = {}) => {
        if (!client.isConnected()) {
            log(`not connected, dropped ${eventName}`);
            return;
        }
        client.realtime.send(eventName, data);
    };

    // The GA client types every event as `unknown`; payload shapes follow the Realtime API docs
    const on = <T,>(eventName: string, handler: (event: T) => void | Promise<void>) =>
        client.realtime.on(eventName, (event) => void handler(event as T));

    const sendRefusal = () => {
        pendingRefusal = true;
        responseRequested = true;
        // The refusal is the answer to what the user said
        answerOwed = false;
        send("response.create", {
            response: { instructions: `${sessionInstructions}\n\n${refusalNote}` },
        });
    };

    // Any server `error` event makes the Stream realtime wrapper disconnect the agent, so:
    // - never send `response.cancel` without an active response
    // - never send `response.create` while a response is still active or requested (cancel is
    //   async and only completes on `response.done`), so the refusal is queued until then
    const refuse = (note: string) => {
        // After the kill-switch only the closing line may be spoken
        if (pendingRefusal || refusalQueued || (killed && note !== KILL_NOTE)) {
            return;
        }
        refusalNote = note;
        if (activeResponseId || responseRequested) {
            refusalQueued = true;
            // A response that is only requested is cancelled once it is created
            if (activeResponseId) {
                send("response.cancel");
            }
            return;
        }
        sendRefusal();
    };

    // Strict: lets the agent answer the user's turn (the session no longer does it by itself)
    const release = (seq = turnSeq) => {
        if (killed || seq <= answeredSeq) {
            return;
        }
        if (userSpeaking) {
            answerOwed = true;
            return;
        }
        answerOwed = false;
        if (activeResponseId || responseRequested || refusalQueued || pendingRefusal) {
            releaseQueued = true;
            return;
        }
        responseRequested = true;
        send("response.create", {});
    };

    // A persistent session instruction (not a per-turn command) keeps the conversation natural
    // instead of repeating the same scripted advice on every self-harm turn
    const enableSupportMode = () => {
        if (supportMode) {
            return;
        }
        supportMode = true;
        sessionInstructions = `${instructions}\n\n${SUPPORT_NOTE}`;
        // The client merges this into its stored config, so turn_detection set earlier is kept
        client.updateSession({ instructions: sessionInstructions });
        log("support mode enabled");
    };

    const endCallOnce = async () => {
        if (callEnded) {
            return;
        }
        callEnded = true;
        log("kill-switch: ending the call");
        for (let attempt = 1; attempt <= END_CALL_ATTEMPTS; attempt++) {
            try {
                await endCall();
                return;
            } catch (error) {
                log(`kill-switch: failed to end the call (attempt ${attempt}/${END_CALL_ATTEMPTS}): ${error}`);
            }
        }
        // Last resort: the agent leaves, so at least nothing more is said; the owner's leaving then
        // ends the call through the session_participant_left webhook
        log("kill-switch: could not end the call, disconnecting the agent");
        client.disconnect();
    };

    // The agent says a closing line first; the call ends on that response's `response.done`
    const kill = () => {
        killed = true;
        if (refusalQueued) {
            // The queued refusal reads the note when it is sent, so it becomes the closing line
            refusalNote = KILL_NOTE;
        } else if (!pendingRefusal) {
            refuse(KILL_NOTE);
        }
        setTimeout(() => void endCallOnce(), KILL_FALLBACK_MS);
    };

    const noteForBlockedTurn = (count: number) => {
        if (count === SAFETY_KILL_AT - 1) {
            return `${REFUSAL_NOTE}\n${FINAL_WARNING_NOTE}`;
        }
        if (count === SAFETY_WARN_AT) {
            return `${REFUSAL_NOTE}\n${WARNING_NOTE}`;
        }
        return REFUSAL_NOTE;
    };

    on("server.error", (event: { error: unknown }) => {
        log(`OpenAI realtime error (Stream wrapper disconnects on this): ${JSON.stringify(event.error)}`);
    });

    on("close", (event: { error: boolean }) => {
        log(`realtime connection closed (error: ${event.error})`);
    });

    on("server.response.created", (event: { response: { id: string } }) => {
        activeResponseId = event.response.id;
        answeredSeq = turnSeq;
        if (mode === "strict" && !responseRequested && !pendingRefusal) {
            log("strict: the session started a response by itself (create_response: false was not applied)");
        }
        responseRequested = false;
        // A refusal came in while this response was only requested; after the kill-switch only the
        // closing line may be spoken, whoever started the response
        if ((refusalQueued || killed) && !pendingRefusal) {
            send("response.cancel");
        }
        responses.set(event.response.id, {
            turn: currentTurn,
            text: "",
            checkedLength: 0,
            checking: false,
            active: true,
            transcriptDone: false,
            isRefusal: pendingRefusal,
            isClosing: killed && pendingRefusal,
            careBlockDeferred: false,
        });
        pendingRefusal = false;
    });

    on(
        "server.response.done",
        (event: { response: { id: string; status: string; status_details?: unknown } }) => {
            const state = responses.get(event.response.id);
            if (state) {
                state.active = false;
            }
            if (activeResponseId === event.response.id) {
                activeResponseId = null;
            }
            if (event.response.status !== "completed") {
                log(`response ${event.response.status}: ${JSON.stringify(event.response.status_details ?? null)}`);
            }
            if (refusalQueued && !activeResponseId) {
                refusalQueued = false;
                sendRefusal();
            } else if (releaseQueued && !activeResponseId) {
                releaseQueued = false;
                release();
            }
            if (state?.isClosing) {
                void endCallOnce();
            }
        }
    );

    on("server.input_audio_buffer.speech_started", () => {
        userSpeaking = true;
        speechStartedAt = performance.now();
    });

    on("server.input_audio_buffer.speech_stopped", () => {
        userSpeaking = false;
        currentTurn = createTurn(++turnSeq, performance.now(), speechStartedAt);
    });

    // The agent's first words for the latest user turn (any response, refusals included)
    const markResponseStart = () => {
        const turn = currentTurn;
        if (!turn || turn.speechStoppedAt === null || turn.responseStartMs !== null) {
            return;
        }
        const responseStartMs = Math.round(performance.now() - turn.speechStoppedAt);
        turn.responseStartMs = responseStartMs;
        void turn.rowId?.then((id) => {
            if (id) {
                void setGuardTurnResponseStart(id, responseStartMs);
            }
        });
    };

    const onBlockedTurn = async (
        transcript: string,
        results: GuardResult[],
        group: { counted: boolean } | null
    ) => {
        if (killed) {
            log(`user turn BLOCK after kill-switch, ignored "${transcript}"`, results);
            return;
        }

        // A later fragment of an utterance that was already counted is refused but not counted again
        if (group?.counted) {
            log(`user turn BLOCK, same utterance already counted "${transcript}"`, results);
            refuse(noteForBlockedTurn(blockedTurns));
            return;
        }
        if (group) {
            group.counted = true;
        }

        // Counted per user utterance, not per detector or fragment (decision A5)
        blockedTurns = (await incrementBlockedTurns(meetingId)) ?? blockedTurns + 1;
        log(
            `user turn BLOCK #${blockedTurns}/${SAFETY_KILL_AT} (agent responding: ${activeResponseId !== null}) "${transcript}"`,
            results
        );

        if (blockedTurns >= SAFETY_KILL_AT) {
            kill();
            return;
        }
        refuse(noteForBlockedTurn(blockedTurns));
    };

    on(
        "server.conversation.item.input_audio_transcription.completed",
        async (event: { transcript: string }) => {
            const transcript = event.transcript?.trim();
            // An empty transcript is usually noise: strict mode only answers a turn it still owes
            if (!transcript) {
                currentTurn?.setText(null);
                currentTurn?.setVerdict(null);
                if (mode === "strict" && answerOwed) {
                    release();
                }
                return;
            }
            if (!currentTurn) {
                currentTurn = createTurn(turnSeq, null);
            }
            const turn = currentTurn;
            // Join the fragment to the utterance it continues, and judge the whole utterance: a
            // fragment alone lacks context ("Làm hộ chiếu online." was flagged as fraud on 29/10)
            const startedAt = turn.speechStartedAt ?? turn.speechStoppedAt ?? performance.now();
            if (!utterance || startedAt - utterance.endedAt > UTTERANCE_GAP_MS) {
                utterance = { texts: [], endedAt: 0, counted: false };
            }
            const group = utterance;
            group.texts.push(transcript);
            group.endedAt = turn.speechStoppedAt ?? performance.now();
            const text = group.texts.join(" ");
            lastUserText = text;
            turn.setText(text);
            const transcribedAt = performance.now();

            // Shadow has nothing to decide: the agent is already answering
            let decision: TurnDecision | null = mode === "shadow" ? "shadow" : null;
            const timer = mode === "strict"
                ? setTimeout(() => {
                    if (decision !== null) {
                        return;
                    }
                    decision = "timeout";
                    log(`strict: no verdict within ${STRICT_TIMEOUT_MS} ms, the agent answers and the guard goes on as shadow "${text}"`);
                    release(turn.seq);
                }, STRICT_TIMEOUT_MS)
                : undefined;

            const { results, severity } = await checkUserInput(text, (result) => {
                // Strict: refuse on the first "block" without waiting for the slower detectors
                if (decision !== null || severityOf(result, "user") !== "block") {
                    return;
                }
                decision = "block";
                turn.severity = "block";
                clearTimeout(timer);
                void onBlockedTurn(text, [result], group);
            });
            clearTimeout(timer);
            const guardMs = Math.round(performance.now() - transcribedAt);
            turn.severity = severity;
            turn.setVerdict(severity);

            // Read through a function: TypeScript narrows `decision` as if the callbacks never ran
            const decided = (): TurnDecision | null => decision;

            // Whether the guard acted before the agent spoke: shadow can only cut an answer in flight
            const caughtInTime = mode === "shadow"
                ? activeResponseId !== null
                : decided() === null || decided() === "block";
            void recordUserInputEvents(
                { meetingId, source: "realtime", content: text, caughtInTime },
                results
            );

            let finalDecision = decided();
            if (finalDecision === null) {
                // Strict, and every detector answered before the timeout
                finalDecision = severity === "block" ? "block" : severity === "care" ? "care" : "safe";
                decision = finalDecision;
                if (severity === "block") {
                    void onBlockedTurn(text, results, group);
                } else {
                    log(`strict: user turn ${severity === "care" ? `CARE "${text}"` : severity === "log" ? "logged" : "safe"} after ${guardMs} ms`, results);
                    if (severity === "care") {
                        // Set before the answer, so the first reply is already supportive
                        enableSupportMode();
                    }
                    release(turn.seq);
                }
            } else if (finalDecision === "block") {
                log(`strict: full verdict of the refused turn after ${guardMs} ms`, results);
            } else if (!severity || severity === "log") {
                // Shadow, or strict after the timeout: act on the verdict as it comes in
                log(`user turn ${severity === "log" ? "logged" : "safe"}`, results);
            } else if (severity === "care") {
                log(`user turn CARE "${text}"`, results);
                enableSupportMode();
            } else {
                await onBlockedTurn(text, results, group);
            }

            turn.rowId = recordGuardTurn({
                meetingId,
                mode,
                content: text,
                decision: finalDecision,
                transcriptionMs: turn.speechStoppedAt === null ? null : Math.round(transcribedAt - turn.speechStoppedAt),
                guardMs,
                responseStartMs: turn.responseStartMs,
                severity,
            });
        }
    );

    // Strict: without a transcript nothing can be checked; fail open like the detectors do
    on("server.conversation.item.input_audio_transcription.failed", (event: { error?: unknown }) => {
        log(`user transcription failed: ${JSON.stringify(event.error ?? null)}`);
        currentTurn?.setText(null);
        currentTurn?.setVerdict(null);
        if (mode === "strict") {
            release();
        }
    });

    const checkResponse = async (responseId: string, isFinal: boolean) => {
        const state = responses.get(responseId);
        if (!state || state.isRefusal || state.checking) {
            return;
        }

        const unchecked = state.text.slice(state.checkedLength);
        const readyToCheck = isFinal
            ? unchecked.trim().length > 0
            : unchecked.length >= MIN_CHUNK_LENGTH && SENTENCE_END.test(unchecked);
        if (!readyToCheck) {
            return;
        }

        state.checking = true;
        state.checkedLength = state.text.length;
        const turn = state.turn;
        // Pair the reply with the message it answers: lastUserText may already be a newer turn, and
        // in shadow mode the answer can start before its own transcript is in
        const query = (turn ? await within(turn.text, TURN_WAIT_MS, null) : null) ?? lastUserText;
        const content = state.text;
        const { results, severity: verdictSeverity } = await checkAgentReply(query, content);
        state.checking = false;
        const caughtInTime = state.active;

        // A content-safety block waits briefly for the user turn's verdict, which can turn it into a
        // log (agentReplySeverity); a verdict that arrives later only changes how the event is recorded
        let userSeverity = turn?.severity;
        if (turn && userSeverity === undefined && verdictSeverity === "block") {
            userSeverity = await within<Severity | null | undefined>(turn.verdict, AGENT_ACTION_WAIT_MS, undefined);
        }
        let severity = maxSeverity(results.map((result) => agentReplySeverity(result, userSeverity)));

        // Reply to a self-harm disclosure, or to a turn whose verdict is still pending (the user
        // detectors can take several seconds): its opening line restates what the user said ("I hear
        // you talking about hurting yourself") and Nemotron blocks it, labels and all, exactly like a
        // harmful reply; with the rest of the reply it is judged safe, whereas harmful replies stay
        // blocked (scripts/thuc-nghiem/care-reply-check.mjs). So the first block waits for more text.
        const moreTextComing = !state.transcriptDone || state.checkedLength < state.text.length;
        const deferCareBlock = (userSeverity === "care" || userSeverity === undefined) && severity === "block" &&
            !state.careBlockDeferred && moreTextComing && isSoleContentSafetyBlock(results, userSeverity);
        if (deferCareBlock) {
            state.careBlockDeferred = true;
            severity = "log";
        }

        void (async () => {
            const recordedSeverity = turn
                ? await within<Severity | null | undefined>(turn.verdict, TURN_VERDICT_WAIT_MS, undefined)
                : undefined;
            for (const result of results) {
                void recordSafetyEvent({
                    meetingId,
                    source: "realtime",
                    role: "agent",
                    content,
                    result,
                    caughtInTime,
                    // A deferred block is evidence, not a verdict; the next check of the reply decides
                    severity: deferCareBlock && agentReplySeverity(result, recordedSeverity) === "block"
                        ? "log"
                        : agentReplySeverity(result, recordedSeverity),
                });
            }
        })();

        if (!severity || severity === "log") {
            log(deferCareBlock
                ? `agent chunk BLOCK deferred: reply to a ${userSeverity === "care" ? "self-harm disclosure" : "turn not judged yet"}, judged again with more text "${content}"`
                : verdictSeverity === "block"
                    ? `agent chunk BLOCK ignored: it answers a blocked user turn, which is already refused "${content}"`
                    : `agent chunk ${severity === "log" ? "logged" : "safe"}`, results);
            // The final check is skipped while another check is in flight, so run it now
            if (state.transcriptDone && state.checkedLength < state.text.length) {
                void checkResponse(responseId, true);
            }
            return;
        }

        // `active` tells whether the verdict came in before the agent finished generating
        log(`agent response ${severity.toUpperCase()} (caught in time: ${caughtInTime}) "${content}"`, results);
        if (severity === "care") {
            // Harmful self-harm content from the agent: cut it and answer supportively instead
            enableSupportMode();
            refuse(SUPPORT_RETRY_NOTE);
            return;
        }
        // Only the Vietnam content policy objected: have the agent correct itself instead of refusing
        const policyOnly = results.every((result) =>
            agentReplySeverity(result, userSeverity) !== "block" || (isVnPolicyResult(result) && result.violation));
        refuse(policyOnly ? VN_CORRECTION_NOTE : REFUSAL_NOTE);
    };

    const onTranscriptDelta = (event: { response_id: string; delta: string }) => {
        const state = responses.get(event.response_id);
        if (!state) {
            return;
        }
        if (state.text === "") {
            markResponseStart();
        }
        state.text += event.delta;
        void checkResponse(event.response_id, false);
    };

    const onTranscriptDone = (event: { response_id: string }) => {
        const state = responses.get(event.response_id);
        if (state) {
            state.transcriptDone = true;
        }
        void checkResponse(event.response_id, true);
    };

    // GA Realtime API event names, plus the beta names in case an older model/proxy is used
    on("server.response.output_audio_transcript.delta", onTranscriptDelta);
    on("server.response.output_audio_transcript.done", onTranscriptDone);
    on("server.response.audio_transcript.delta", onTranscriptDelta);
    on("server.response.audio_transcript.done", onTranscriptDone);

    // The first request to each detector pays connection setup (observed ~10 s); warm them up
    // so the user's first turn is checked at normal latency. Results are not recorded.
    void checkUserInput("Hello").then((warmup) => log("warmed up", warmup.results));

    log(`attached (${mode}${mode === "strict" ? `, timeout ${STRICT_TIMEOUT_MS} ms` : ""}${supportMode ? ", support mode" : ""})`);

    return {
        // The kill-switch fired: the agent must not be reconnected
        killed: () => killed,
    };
}
