import "server-only";
import type { RealtimeClient } from "@stream-io/openai-realtime-api";

import { checkSafety, type SafetyResult } from "@/lib/nemotron";
import type { JailbreakResult } from "@/lib/jailbreak";
import { checkUserInput, recordSafetyEvent, recordUserInputEvents } from "@/lib/safety-events";

const REFUSAL_INSTRUCTIONS = `
The previous exchange was flagged by the safety system.
Briefly and politely tell the user you cannot help with that request,
then offer to continue with another topic. Do not repeat or explain the unsafe content.
`.trim();

// Sentence boundaries used to chunk the agent transcript (also covers Vietnamese punctuation usage)
const SENTENCE_END = /[.!?…]\s*$/;
const MIN_CHUNK_LENGTH = 40;

interface ResponseState {
    text: string;
    checkedLength: number;
    checking: boolean;
    active: boolean;
    transcriptDone: boolean;
    isRefusal: boolean;
}

/**
 * Shadow guard for the OpenAI Realtime agent: user and agent transcripts are classified by
 * Nemotron in parallel with the conversation (no added latency). When something is flagged,
 * the in-flight response is cancelled and the agent is told to refuse.
 */
export function attachRealtimeGuard(
    client: RealtimeClient,
    { meetingId }: { meetingId: string }
) {
    const responses = new Map<string, ResponseState>();
    let activeResponseId: string | null = null;
    let lastUserText = "";
    let pendingRefusal = false;
    let refusalQueued = false;

    const log = (message: string, results: (SafetyResult | JailbreakResult)[] = []) => {
        const details = results
            .map((result) => {
                const verdict = "detector" in result
                    ? `${result.detector}=${result.jailbreak ? "JAILBREAK" : "ok"}${result.technique ? `(${result.technique})` : ""}`
                    // Nemotron returns one category list for the whole exchange, so show both verdicts
                    : `content_safety=user:${result.userSafe ? "safe" : "UNSAFE"}` +
                      (result.responseSafe === null ? "" : `,agent:${result.responseSafe ? "safe" : "UNSAFE"}`) +
                      `[${result.categories.join(", ")}]`;
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
            response: { instructions: REFUSAL_INSTRUCTIONS },
        });
    };

    // Any server `error` event makes the Stream realtime wrapper disconnect the agent, so:
    // - never send `response.cancel` without an active response
    // - never send `response.create` while a response is still active (cancel is async and
    //   only completes on `response.done`), so the refusal is queued until then
    const refuse = () => {
        if (pendingRefusal || refusalQueued) {
            return;
        }
        if (activeResponseId) {
            refusalQueued = true;
            client.realtime.send("response.cancel", {});
            return;
        }
        sendRefusal();
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

            const { results, unsafe } = await checkUserInput(transcript);
            void recordUserInputEvents(
                {
                    meetingId,
                    source: "realtime",
                    content: transcript,
                    caughtInTime: activeResponseId !== null,
                },
                results
            );
            if (!unsafe) {
                log("user turn safe", results);
                return;
            }

            log(`user turn UNSAFE (agent responding: ${activeResponseId !== null}) "${transcript}"`, results);
            refuse();
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
        const result = await checkSafety({ query: lastUserText, response: state.text });
        state.checking = false;
        void recordSafetyEvent({
            meetingId,
            source: "realtime",
            role: "agent",
            content: state.text,
            result,
            caughtInTime: state.active,
        });

        if (result.responseSafe !== false) {
            log("agent chunk safe", [result]);
            // The final check is skipped while another check is in flight, so run it now
            if (state.transcriptDone && state.checkedLength < state.text.length) {
                void checkResponse(responseId, true);
            }
            return;
        }

        // `active` tells whether the verdict came in before the agent finished generating
        log(`agent response UNSAFE (caught in time: ${state.active}) "${state.text}"`, [result]);
        refuse();
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
