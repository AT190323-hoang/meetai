import "server-only";
import type { RealtimeClient } from "@stream-io/openai-realtime-api";

import { db } from "@/db";
import { transcriptItems } from "@/db/schema";

// Agent speech rate used to estimate how much of an interrupted reply was heard, until the call's
// own completed replies give a measured one (Vietnamese words are single syllables)
const DEFAULT_WORDS_PER_SECOND = 3.5;
// Replies are written when their audio stops playing; this long after response.done at most
const PLAYBACK_WAIT_MS = 60_000;

interface Reply {
    createdAt: number;
    playStartedAt: number | null;
    playStoppedAt: number | null;
    text: string | null;
    status: string | null;
    doneAt: number | null;
    written: boolean;
}

/**
 * Records the call's Vietnamese transcript from the realtime session (docs/khao-sat/vn-transcript.md): the user's speech as transcribed for the guard, and each agent reply as the
 * model generated it. Stream's own transcript is an English translation, because Stream has no
 * Vietnamese. Listen-only: it never sends anything to the session, so it cannot disturb the call.
 *
 * Generated text runs ahead of the audio, so an interrupted reply is cut to the part that was
 * played (playback time × the agent's measured speech rate) and marked as interrupted.
 */
export function attachTranscriptRecorder(
    client: RealtimeClient,
    { meetingId, userId, agentId }: { meetingId: string; userId: string; agentId: string }
) {
    const attachedAt = performance.now();
    const now = () => Math.round(performance.now() - attachedAt);
    // Utterances whose transcript is still pending, oldest first
    const utterances: { startMs: number | null; endMs: number }[] = [];
    let speechStartedAt: number | null = null;
    const replies = new Map<string, Reply>();
    let measuredWords = 0;
    let measuredMs = 0;

    const on = <T,>(eventName: string, handler: (event: T) => void) =>
        client.realtime.on(eventName, (event) => handler(event as T));

    const write = async (row: Omit<typeof transcriptItems.$inferInsert, "meetingId">) => {
        // One retry: transient connect timeouts to Neon were observed during calls
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                await db.insert(transcriptItems).values({ meetingId, ...row });
                return;
            } catch (error) {
                if (attempt === 2) {
                    console.error(`[transcript][${meetingId}] failed to record a transcript line`, error);
                }
            }
        }
    };

    on("server.input_audio_buffer.speech_started", () => {
        speechStartedAt = now();
    });

    on("server.input_audio_buffer.speech_stopped", () => {
        utterances.push({ startMs: speechStartedAt, endMs: now() });
        speechStartedAt = null;
    });

    const takeUtterance = () => utterances.shift() ?? { startMs: null, endMs: now() };

    on("server.conversation.item.input_audio_transcription.completed", (event: { transcript?: string }) => {
        const utterance = takeUtterance();
        const text = event.transcript?.trim();
        if (text) {
            void write({ speakerId: userId, role: "user", content: text, startMs: utterance.startMs ?? utterance.endMs, endMs: utterance.endMs });
        }
    });

    on("server.conversation.item.input_audio_transcription.failed", () => {
        takeUtterance();
    });

    const reply = (id: string) => replies.get(id);

    on("server.response.created", (event: { response: { id: string } }) => {
        replies.set(event.response.id, {
            createdAt: now(), playStartedAt: null, playStoppedAt: null, text: null, status: null, doneAt: null, written: false,
        });
    });

    on("server.output_audio_buffer.started", (event: { response_id: string }) => {
        const state = reply(event.response_id);
        if (state && state.playStartedAt === null) {
            state.playStartedAt = now();
        }
    });

    const writeReply = (id: string) => {
        const state = reply(id);
        if (!state || state.written || !state.text) {
            return;
        }
        state.written = true;
        replies.delete(id);
        const startMs = state.playStartedAt ?? state.createdAt;

        if (state.status === "completed") {
            const endMs = state.playStoppedAt ?? state.doneAt ?? now();
            const playedMs = state.playStoppedAt !== null && state.playStartedAt !== null
                ? state.playStoppedAt - state.playStartedAt
                : 0;
            // Calibrate the speech rate on replies that were played in full
            if (playedMs > 1000) {
                measuredWords += state.text.split(/\s+/).length;
                measuredMs += playedMs;
            }
            void write({ speakerId: agentId, role: "agent", content: state.text, startMs, endMs });
            return;
        }

        // Cancelled (barge-in or the guard): nothing was heard if playback never started
        if (state.playStartedAt === null) {
            return;
        }
        const endMs = state.doneAt ?? now();
        const wordsPerSecond = measuredMs > 2000 ? measuredWords / (measuredMs / 1000) : DEFAULT_WORDS_PER_SECOND;
        const words = state.text.split(/\s+/);
        const heardWords = Math.ceil(((endMs - state.playStartedAt) / 1000) * wordsPerSecond);
        if (heardWords <= 0) {
            return;
        }
        const content = heardWords < words.length ? `${words.slice(0, heardWords).join(" ")}…` : state.text;
        void write({ speakerId: agentId, role: "agent", content, startMs, endMs, interrupted: true });
    };

    on(
        "server.response.done",
        (event: { response: { id: string; status: string; output?: { content?: { transcript?: string }[] }[] } }) => {
            const state = reply(event.response.id);
            if (!state) {
                return;
            }
            state.status = event.response.status;
            state.doneAt = now();
            state.text = (event.response.output ?? [])
                .flatMap((item) => item.content ?? [])
                .map((part) => part.transcript ?? "")
                .join(" ")
                .trim() || null;

            if (state.status !== "completed" || state.playStoppedAt !== null) {
                writeReply(event.response.id);
                return;
            }
            // Generation ends well before playback: wait for the audio to stop
            setTimeout(() => writeReply(event.response.id), PLAYBACK_WAIT_MS);
        }
    );

    on("server.output_audio_buffer.stopped", (event: { response_id: string }) => {
        const state = reply(event.response_id);
        if (!state) {
            return;
        }
        state.playStoppedAt = now();
        if (state.status !== null) {
            writeReply(event.response_id);
        }
    });
}
