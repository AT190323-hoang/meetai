// Checks that a realtime model works through Stream's connect_agent proxy, and measures its reply
// latency, without a human in the call (docs/khao-sat/doi-model.md). Creates a throwaway call and
// agent user, sends text questions, records time to the first transcript delta and to response.done,
// then deletes the call. Text input skips speech recognition, so real calls add that delay on top.
// Usage (from repo root):
//   node --dns-result-order=ipv4first --env-file=.env scripts/thuc-nghiem/realtime-model-check.cjs gpt-realtime-2.1 gpt-realtime
// A model can carry a reasoning effort ("gpt-realtime-2.1@low", sent as a raw session.update);
// REPEAT=n asks every question n times.
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/package.json");
const { StreamClient } = req("@stream-io/node-sdk");

const video = new StreamClient(process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY, process.env.STREAM_VIDEO_SECRET_KEY, { timeout: 30000 });
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["gpt-realtime-2.1"];
const QUESTIONS = [
  "Xin chào, bạn giới thiệu ngắn về bản thân nhé.",
  "Tích phân là gì? Giải thích trong hai câu.",
  "Đọc lại giúp tôi số điện thoại 0354 099 123.",
];
const INSTRUCTIONS = "Bạn là trợ lý học toán, luôn trả lời bằng tiếng Việt, ngắn gọn.";
const TIMEOUT_MS = 60_000;
const REPEAT = Number(process.env.REPEAT ?? 1);

// Connections to Stream from the dev machine time out now and then; retry setup calls
async function retry(task, attempts = 4) {
  for (let i = 1; ; i++) {
    try { return await task(); }
    catch (error) { if (i >= attempts) throw error; console.log(`retry ${i}: ${String(error.message).slice(0, 80)}`); }
  }
}

// The client has no way to remove a listener, so each client gets one set of handlers that report
// to the question in flight
function createAsker(client) {
  let current = null;
  const finish = (status) => {
    if (!current) return;
    const { resolve, timer, startedAt, firstDelta, transcript } = current;
    current = null;
    clearTimeout(timer);
    resolve({ status, firstDeltaMs: firstDelta, doneMs: Math.round(performance.now() - startedAt), transcript });
  };
  const onDelta = (event) => {
    if (!current) return;
    if (current.firstDelta === null) current.firstDelta = Math.round(performance.now() - current.startedAt);
    current.transcript += event.delta;
  };
  client.realtime.on("server.response.output_audio_transcript.delta", onDelta);
  client.realtime.on("server.response.audio_transcript.delta", onDelta);
  client.realtime.on("server.response.done", (event) => finish(event.response?.status ?? "done"));
  client.realtime.on("server.error", (event) => {
    const message = `error: ${JSON.stringify(event.error).slice(0, 150)}`;
    // Errors outside a question (e.g. a rejected session.update) would otherwise go unseen
    if (!current) console.log(message);
    finish(message);
  });
  client.realtime.on("server.session.updated", (event) => {
    if (event.session?.reasoning) console.log(`session reasoning: ${JSON.stringify(event.session.reasoning)}`);
  });

  return (text) => new Promise((resolve) => {
    current = { resolve, startedAt: performance.now(), firstDelta: null, transcript: "", timer: setTimeout(() => finish("timeout"), TIMEOUT_MS) };
    client.realtime.send("conversation.item.create", {
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    client.realtime.send("response.create", {});
  });
}

async function checkModel(spec) {
  const [model, effort] = spec.split("@");
  const run = Date.now().toString(36);
  const agentId = `modeltest-agent-${run}`;
  const callId = `modeltest-call-${run}`;
  await retry(() => video.upsertUsers([{ id: agentId, name: "model test agent", role: "user" }]));
  const call = video.video.call("default", callId);
  await retry(() => call.create({ data: { created_by_id: agentId, members: [{ user_id: agentId, role: "call_member" }] } }));

  const rows = [];
  try {
    const connectStartedAt = performance.now();
    const client = await retry(() => video.video.connectOpenAi({ call, openAiApiKey: process.env.OPENAI_API_KEY, agentUserId: agentId, model }));
    const connectMs = Math.round(performance.now() - connectStartedAt);
    // Same session setup as the webhook
    client.updateSession({ instructions: INSTRUCTIONS, turn_detection: { type: "server_vad" } });
    if (effort) {
      // The client's updateSession only forwards the fields it knows, so reasoning goes raw
      client.realtime.send("session.update", { session: { type: "realtime", reasoning: { effort } } });
    }
    console.log(`[${model}] connected through Stream in ${connectMs} ms`);
    const ask = createAsker(client);
    for (let round = 0; round < REPEAT; round++) for (const question of QUESTIONS) {
      const result = await ask(question);
      rows.push({ model: spec, question: question.slice(0, 30), ...result, transcript: result.transcript.replace(/\s+/g, " ").slice(0, 90) });
    }
    client.disconnect?.();
  } catch (error) {
    rows.push({ model: spec, question: "(connect)", status: `FAILED: ${String(error.message ?? error).slice(0, 150)}` });
  } finally {
    await call.end().catch(() => {});
    await call.delete({ hard: true }).catch(() => {});
    await video.deleteUsers({ user_ids: [agentId], user: "hard" }).catch(() => {});
  }
  return rows;
}

(async () => {
  const all = [];
  for (const model of models) all.push(...(await checkModel(model)));
  if (REPEAT === 1) {
    console.table(all.map(({ transcript, ...row }) => row));
    for (const row of all) if (row.transcript) console.log(`${row.model} | ${row.question} → ${row.transcript}`);
  }
  // Per model: time to first transcript delta (≈ when the agent starts speaking)
  const pct = (values, p) => values[Math.min(values.length - 1, Math.floor((p / 100) * values.length))];
  const summary = [...new Set(all.map((row) => row.model))].map((model) => {
    const ok = all.filter((row) => row.model === model && row.status === "completed");
    const first = ok.map((row) => row.firstDeltaMs).filter((v) => v !== null).sort((a, b) => a - b);
    return { model, completed: `${ok.length}/${all.filter((row) => row.model === model).length}`, firstDelta_p50: pct(first, 50), firstDelta_p90: pct(first, 90), errors: all.filter((row) => row.model === model && row.status !== "completed").map((row) => row.status).join(" | ").slice(0, 120) };
  });
  console.table(summary);
  process.exit(0);
})();
