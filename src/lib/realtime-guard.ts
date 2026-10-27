import "server-only";
import type { RealtimeClient } from "@stream-io/openai-realtime-api";

import {
    checkAgentReply,
    checkUserInput,
    incrementBlockedTurns,
    isVnPolicyResult,
    recordSafetyEvent,
    recordUserInputEvents,
    severityOf,
    type GuardResult,
} from "@/lib/safety-events";
import { VN_CORRECTION_NOTE } from "@/lib/vn-policy";
import {
    FINAL_WARNING_NOTE,
    KILL_NOTE,
    REFUSAL_NOTE,
    SAFETY_KILL_AT,
    SAFETY_WARN_AT,
    SUPPORT_NOTE,
    SUPPORT_RETRY_NOTE,
    WARNING_NOTE,
} from "@/lib/safety-policy";

// Sentence boundaries used to chunk the agent transcript (also covers Vietnamese punctuation usage)
const SENTENCE_END = /[.!?…]\s*$/;
const MIN_CHUNK_LENGTH = 40;
// The call is ended after the closing line is spoken, or after this long if it never completes
const KILL_FALLBACK_MS = 15_000;

interface ResponseState {
    text: string;
    checkedLength: number;
    checking: boolean;
    active: boolean;
    transcriptDone: boolean;
    isRefusal: boolean;
    // The kill-switch closing line; the call ends when it is done
    isClosing: boolean;
}

/**
 * Shadow guard for the OpenAI Realtime agent: user and agent transcripts are classified by
 * Nemotron in parallel with the conversation (no added latency). Verdicts are acted on by
 * policy tier (src/lib/safety-policy.ts): "block" cancels the in-flight response and makes the
 * agent refuse, "care" switches the session to a supportive mode once, "log" only records.
 * Blocked user turns escalate: a warning, a final warning, then the kill-switch ends the call.
 */
export function attachRealtimeGuard(
    client: RealtimeClient,
    {
        meetingId,
        instructions,
        endCall,
    }: { meetingId: string; instructions: string; endCall: () => Promise<unknown> }
) {
    const responses = new Map<string, ResponseState>();
    let activeResponseId: string | null = null;
    let lastUserText = "";
    let pendingRefusal = false;
    let refusalQueued = false;
    // Guard notes are appended to the agent's instructions instead of replacing them
    let sessionInstructions = instructions;
    let refusalNote = REFUSAL_NOTE;
    let supportMode = false;
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

    // The GA client types every event as `unknown`; payload shapes follow the Realtime API docs
    const on = <T,>(eventName: string, handler: (event: T) => void | Promise<void>) =>
        client.realtime.on(eventName, (event) => void handler(event as T));

    const sendRefusal = () => {
        pendingRefusal = true;
        client.realtime.send("response.create", {
            response: { instructions: `${sessionInstructions}\n\n${refusalNote}` },
        });
    };

    // Any server `error` event makes the Stream realtime wrapper disconnect the agent, so:
    // - never send `response.cancel` without an active response
    // - never send `response.create` while a response is still active (cancel is async and
    //   only completes on `response.done`), so the refusal is queued until then
    const refuse = (note: string) => {
        // After the kill-switch only the closing line may be spoken
        if (pendingRefusal || refusalQueued || (killed && note !== KILL_NOTE)) {
            return;
        }
        refusalNote = note;
        if (activeResponseId) {
            refusalQueued = true;
            client.realtime.send("response.cancel", {});
            return;
        }
        sendRefusal();
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

    const endCallOnce = () => {
        if (callEnded) {
            return;
        }
        callEnded = true;
        log("kill-switch: ending the call");
        endCall().catch((error) => log(`kill-switch: failed to end the call: ${error}`));
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
        setTimeout(endCallOnce, KILL_FALLBACK_MS);
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
        responses.set(event.response.id, {
            text: "",
            checkedLength: 0,
            checking: false,
            active: true,
            transcriptDone: false,
            isRefusal: pendingRefusal,
            isClosing: killed && pendingRefusal,
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
            }
            if (state?.isClosing) {
                endCallOnce();
            }
        }
    );

    on(
        "server.conversation.item.input_audio_transcription.completed",
        async (event: { transcript: string }) => {
            const transcript = event.transcript?.trim();
            if (!transcript) {
                return;
            }
            lastUserText = transcript;

            const { results, severity } = await checkUserInput(transcript);
            void recordUserInputEvents(
                {
                    meetingId,
                    source: "realtime",
                    content: transcript,
                    caughtInTime: activeResponseId !== null,
                },
                results
            );
            if (!severity || severity === "log") {
                log(`user turn ${severity === "log" ? "logged" : "safe"}`, results);
                return;
            }
            if (severity === "care") {
                log(`user turn CARE "${transcript}"`, results);
                enableSupportMode();
                return;
            }

            if (killed) {
                log(`user turn BLOCK after kill-switch, ignored "${transcript}"`, results);
                return;
            }

            // Counted per user turn, not per detector (decision A5)
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
        }
    );

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
        const { results, severity } = await checkAgentReply(lastUserText, state.text);
        state.checking = false;
        for (const result of results) {
            void recordSafetyEvent({
                meetingId,
                source: "realtime",
                role: "agent",
                content: state.text,
                result,
                caughtInTime: state.active,
            });
        }

        if (!severity || severity === "log") {
            log(`agent chunk ${severity === "log" ? "logged" : "safe"}`, results);
            // The final check is skipped while another check is in flight, so run it now
            if (state.transcriptDone && state.checkedLength < state.text.length) {
                void checkResponse(responseId, true);
            }
            return;
        }

        // `active` tells whether the verdict came in before the agent finished generating
        log(`agent response ${severity.toUpperCase()} (caught in time: ${state.active}) "${state.text}"`, results);
        if (severity === "care") {
            // Harmful self-harm content from the agent: cut it and answer supportively instead
            enableSupportMode();
            refuse(SUPPORT_RETRY_NOTE);
            return;
        }
        // Only the Vietnam content policy objected: have the agent correct itself instead of refusing
        const policyOnly = results.every((result) =>
            severityOf(result, "agent") !== "block" || (isVnPolicyResult(result) && result.violation));
        refuse(policyOnly ? VN_CORRECTION_NOTE : REFUSAL_NOTE);
    };

    const onTranscriptDelta = (event: { response_id: string; delta: string }) => {
        const state = responses.get(event.response_id);
        if (!state) {
            return;
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

    log("attached");
}
