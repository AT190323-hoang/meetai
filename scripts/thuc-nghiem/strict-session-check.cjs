// Checks the session behaviour strict mode relies on, without a human in the call (A2 survey):
// with turn_detection.create_response = false, does the agent stay silent after the user speaks,
// does the Vietnamese transcript still arrive, and does a manual response.create still answer?
// A Vietnamese sentence is synthesised with OpenAI TTS and streamed into the agent's session through
// Stream's proxy (throwaway call), followed by silence so server VAD ends the turn.
// Usage (from repo root):
//   node --dns-result-order=ipv4first --env-file=.env scripts/thuc-nghiem/strict-session-check.cjs [shadow|strict]
// STT_MODEL picks the user transcription model (default gpt-transcribe, as in the app).
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/package.json");
const { StreamClient } = req("@stream-io/node-sdk");

const MODE = process.argv[2] === "shadow" ? "shadow" : "strict";
const MODEL = process.env.REALTIME_MODEL ?? "gpt-realtime-2.1";
const SENTENCE = "Xin chào, bạn giải thích giúp tôi tích phân là gì được không?";
const WAIT_FOR_AUTO_RESPONSE_MS = 6000;

const video = new StreamClient(process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY, process.env.STREAM_VIDEO_SECRET_KEY, { timeout: 30000 });

async function retry(task, attempts = 4) {
  for (let i = 1; ; i++) {
    try { return await task(); }
    catch (error) { if (i >= attempts) throw error; console.log(`retry ${i}: ${String(error.message).slice(0, 80)}`); }
  }
}

// 24 kHz mono PCM16, the Realtime API's default input format
async function synthesize(text) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  const speech = await retry(() => synthesize(SENTENCE));
  const silence = Buffer.alloc(24000 * 2 * 1.5); // 1.5 s, enough for server VAD to end the turn
  console.log(`speech: ${(speech.length / 48000).toFixed(1)} s of audio`);

  const run = Date.now().toString(36);
  const agentId = `stricttest-agent-${run}`;
  const callId = `stricttest-call-${run}`;
  await retry(() => video.upsertUsers([{ id: agentId, name: "strict test agent", role: "user" }]));
  const call = video.video.call("default", callId);
  await retry(() => call.create({ data: { created_by_id: agentId, members: [{ user_id: agentId, role: "call_member" }] } }));

  const t0 = performance.now();
  const at = () => `${Math.round(performance.now() - t0)} ms`;
  const events = [];
  try {
    const client = await retry(() => video.video.connectOpenAi({ call, openAiApiKey: process.env.OPENAI_API_KEY, agentUserId: agentId, model: MODEL }));
    for (const name of [
      "server.input_audio_buffer.speech_started",
      "server.input_audio_buffer.speech_stopped",
      "server.conversation.item.input_audio_transcription.completed",
      "server.response.created",
      "server.response.done",
      "server.error",
    ]) {
      client.realtime.on(name, (event) => {
        const detail = event.transcript ?? event.response?.status ?? (event.error ? JSON.stringify(event.error) : "");
        events.push({ at: at(), event: name.replace("server.", ""), detail: String(detail).slice(0, 80) });
      });
    }
    // Same session setup as the webhook
    client.updateSession({
      instructions: "Bạn là trợ lý học toán, luôn trả lời bằng tiếng Việt, ngắn gọn.",
      turn_detection: MODE === "strict"
        ? { type: "server_vad", create_response: false, interrupt_response: true }
        : { type: "server_vad" },
      input_audio_transcription: { model: process.env.STT_MODEL ?? "gpt-transcribe", language: "vi" },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Stream the audio in 100 ms chunks, like a live microphone
    const audio = Buffer.concat([speech, silence]);
    const CHUNK = 4800;
    for (let i = 0; i < audio.length; i += CHUNK) {
      client.realtime.send("input_audio_buffer.append", { audio: audio.subarray(i, i + CHUNK).toString("base64") });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    events.push({ at: at(), event: "(audio sent)", detail: "" });

    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_AUTO_RESPONSE_MS));
    const autoResponses = events.filter((e) => e.event === "response.created").length;
    console.log(`[${MODE}] responses created by the session itself within ${WAIT_FOR_AUTO_RESPONSE_MS} ms: ${autoResponses}`);

    if (MODE === "strict") {
      events.push({ at: at(), event: "(manual response.create)", detail: "" });
      client.realtime.send("response.create", {});
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
    console.table(events);
    client.disconnect?.();
  } finally {
    await call.end().catch(() => {});
    await call.delete({ hard: true }).catch(() => {});
    await video.deleteUsers({ user_ids: [agentId], user: "hard" }).catch(() => {});
  }
  process.exit(0);
})();
