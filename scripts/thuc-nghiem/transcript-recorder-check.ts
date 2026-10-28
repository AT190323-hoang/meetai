// Self-check of the Vietnamese transcript recorder without a call (docs/khao-sat/vn-transcript.md):
// replays the realtime events seen through Stream's proxy (a completed reply, a cancelled one, a
// sentence split by a pause) on a fake client, reads the transcript back, then deletes the rows.
// Usage (from repo root, needs a meeting id that exists, e.g. an old test meeting):
//   npx tsx --conditions=react-server --env-file=.env scripts/thuc-nghiem/transcript-recorder-check.ts <meetingId>
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transcriptItems } from "@/db/schema";
import { getRealtimeTranscript } from "@/lib/transcript";
import { attachTranscriptRecorder } from "@/lib/transcript-recorder";

const meetingId = process.argv[2];
const handlers: Record<string, ((event: unknown) => void)[]> = {};
const fakeClient = { realtime: { on: (name: string, handler: (event: unknown) => void) => { (handlers[name] ??= []).push(handler); } } };
const emit = (name: string, event: unknown = {}) => (handlers[`server.${name}`] ?? []).forEach((handler) => handler(event));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const done = (id: string, status: string, transcript: string) =>
    emit("response.done", { response: { id, status, output: [{ content: [{ transcript }] }] } });

const FULL = "Chào bạn, mình là trợ lý học toán. Hôm nay bạn muốn ôn phần nào?"; // 14 words
const LONG = "Lịch sử toán học bắt đầu từ thời cổ đại với người Ai Cập và người Babylon, họ dùng toán để đo ruộng đất và tính lịch, sau đó người Hy Lạp xây dựng hình học thành một môn học chặt chẽ.";

(async () => {
    attachTranscriptRecorder(fakeClient as never, { meetingId, userId: "USER", agentId: "AGENT", callStartedAt: Date.now() });

    // 1. The user speaks, the agent answers and plays it in full (4 s of audio)
    emit("input_audio_buffer.speech_started"); await wait(800);
    emit("input_audio_buffer.speech_stopped"); await wait(300);
    emit("conversation.item.input_audio_transcription.completed", { transcript: "Xin chào." });
    emit("response.created", { response: { id: "r1" } }); await wait(300);
    emit("output_audio_buffer.started", { response_id: "r1" }); await wait(400);
    done("r1", "completed", FULL); await wait(3600);
    emit("output_audio_buffer.stopped", { response_id: "r1" });

    // 2. One sentence split by a pause: two user lines that should merge
    emit("input_audio_buffer.speech_started"); await wait(500);
    emit("input_audio_buffer.speech_stopped");
    emit("input_audio_buffer.speech_started"); await wait(700);
    emit("input_audio_buffer.speech_stopped"); await wait(200);
    emit("conversation.item.input_audio_transcription.completed", { transcript: "Kể cho tôi" });
    emit("conversation.item.input_audio_transcription.completed", { transcript: "về lịch sử toán học." });

    // 3. A long reply cancelled after 2 s of playback (barge-in or the guard)
    emit("response.created", { response: { id: "r2" } }); await wait(300);
    emit("output_audio_buffer.started", { response_id: "r2" }); await wait(2000);
    done("r2", "cancelled", LONG);

    // 4. A reply cancelled before any audio played: must not appear
    emit("response.created", { response: { id: "r3" } }); await wait(100);
    done("r3", "cancelled", "Câu này chưa được phát.");

    await wait(5000); // let the writes land (the first one opens a connection to Neon)
    const transcript = await getRealtimeTranscript(meetingId);
    console.table(transcript.map((item) => ({ speaker: item.speaker_id, start: item.start_ts, stop: item.stop_ts, text: item.text })));
    const rows = await db.select().from(transcriptItems).where(eq(transcriptItems.meetingId, meetingId));
    console.log("rows:", rows.length, "interrupted:", rows.filter((row) => row.interrupted).map((row) => row.content));

    const checks = [
        ["first user line recorded", transcript[0]?.speaker_id === "USER" && transcript[0]?.text === "Xin chào."],
        ["completed reply recorded in full", transcript.some((item) => item.speaker_id === "AGENT" && item.text === FULL)],
        ["split sentence merged", transcript.some((item) => item.text === "Kể cho tôi về lịch sử toán học.")],
        ["cancelled reply cut short and marked", rows.some((row) => row.interrupted && row.content.endsWith("…") && row.content.length < LONG.length)],
        ["unplayed reply not recorded", !rows.some((row) => row.content.includes("chưa được phát"))],
        ["lines in time order", transcript.every((item, i) => i === 0 || item.start_ts >= transcript[i - 1].start_ts)],
    ] as const;
    for (const [name, ok] of checks) console.log(ok ? "PASS" : "FAIL", name);

    await db.delete(transcriptItems).where(eq(transcriptItems.meetingId, meetingId));
    process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
})();
