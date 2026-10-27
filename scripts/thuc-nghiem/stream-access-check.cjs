// Access-control check for Stream chat and video (docs/khao-sat/stream-auth.md).
// Creates throwaway users, a channel and a call, then checks what an intruder (another app user) and
// the owner can do with the tokens the app issues. Cleans up afterwards. Touches no real meeting.
// Usage (from repo root): node --dns-result-order=ipv4first --env-file=.env scripts/thuc-nghiem/stream-access-check.cjs
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/package.json");
const { StreamClient } = req("@stream-io/node-sdk");
const { StreamChat } = req("stream-chat");

const KEY = process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY;
const video = new StreamClient(KEY, process.env.STREAM_VIDEO_SECRET_KEY, { timeout: 30000 });
const chat = StreamChat.getInstance(process.env.NEXT_PUBLIC_STREAM_CHAT_API_KEY, process.env.STREAM_CHAT_SECRET_KEY, { timeout: 30000 });

const run = Date.now().toString(36);
const OWNER = `sectest-owner-${run}`;
const INTRUDER = `sectest-intruder-${run}`;
const AGENT = `sectest-agent-${run}`;
const CALL_ID = `sectest-call-${run}`;
const CHANNEL_ID = `sectest-channel-${run}`;
// Meetings created before this fix have calls without members
const LEGACY_CALL_ID = `sectest-legacy-${run}`;
const exp = () => Math.floor(Date.now() / 1000) + 600;

const results = [];
const record = (who, action, ok, expected, detail = "") => {
  results.push({ who, action, allowed: ok, expected, verdict: ok === expected ? "OK" : "UNEXPECTED", detail });
};

async function videoRequest(token, method, path, body) {
  const res = await fetch(`https://video.stream-io-api.com/video${path}?api_key=${KEY}`, {
    method,
    headers: { Authorization: token, "stream-auth-type": "jwt", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, detail: res.ok ? "" : text.slice(0, 120) };
}

async function chatAccess(userId, token) {
  const client = new StreamChat(process.env.NEXT_PUBLIC_STREAM_CHAT_API_KEY, { allowServerSideConnect: true, timeout: 30000 });
  await client.connectUser({ id: userId }, token);
  const out = {};
  const channel = client.channel("messaging", CHANNEL_ID);
  try { const s = await channel.watch(); out.read = { ok: true, detail: `${s.messages.length} messages` }; }
  catch (e) { out.read = { ok: false, detail: String(e.message).slice(0, 120) }; }
  try { await channel.sendMessage({ text: "intrusion test" }); out.write = { ok: true }; }
  catch (e) { out.write = { ok: false, detail: String(e.message).slice(0, 120) }; }
  await client.disconnectUser();
  return out;
}

async function main() {
  // Setup (server side, like procedures.ts after the fix)
  await video.upsertUsers([
    { id: OWNER, name: "sectest owner", role: "user" },
    { id: INTRUDER, name: "sectest intruder", role: "user" },
    { id: AGENT, name: "sectest agent", role: "user" },
  ]);
  await video.video.call("default", CALL_ID).create({
    data: { created_by_id: OWNER, members: [{ user_id: OWNER, role: "call_member" }, { user_id: AGENT, role: "call_member" }] },
  });
  const channel = chat.channel("messaging", CHANNEL_ID, { created_by_id: OWNER, members: [OWNER] });
  await channel.create();
  await channel.sendMessage({ text: "secret meeting summary", user_id: OWNER });

  await video.video.call("default", LEGACY_CALL_ID).create({ data: { created_by_id: OWNER } });

  const ownerCallToken = video.generateCallToken({ user_id: OWNER, call_cids: [`default:${CALL_ID}`], exp: exp() });
  const agentUserToken = video.generateUserToken({ user_id: AGENT, exp: exp() });

  // Chat: intruder as "admin" (old code) and as "user" (new code); owner as "user"
  for (const role of ["admin", "user"]) {
    await chat.upsertUser({ id: INTRUDER, role });
    const a = await chatAccess(INTRUDER, chat.createToken(INTRUDER, exp()));
    record(`intruder (chat role ${role})`, "read owner's chat", a.read.ok, role === "admin", a.read.detail);
    record(`intruder (chat role ${role})`, "write owner's chat", a.write.ok, role === "admin", a.write.detail);
  }
  await chat.upsertUser({ id: OWNER, role: "user" });
  const o = await chatAccess(OWNER, chat.createToken(OWNER, exp()));
  record("owner (chat role user, member)", "read own chat", o.read.ok, true, o.read.detail);

  // Video: intruder as "admin" and as "user" with a plain user token (old code)
  const intruderToken = video.generateUserToken({ user_id: INTRUDER, exp: exp() });
  for (const role of ["admin", "user"]) {
    await video.upsertUsers([{ id: INTRUDER, role }]);
    const expected = process.env.EXPECT_USER_LOCKED === "1" && role === "user" ? false : true;
    for (const [action, method, path, body] of [
      ["read owner's call", "GET", `/call/default/${CALL_ID}`],
      ["list owner's recordings", "GET", `/call/default/${CALL_ID}/recordings`],
      ["join owner's call", "POST", `/call/default/${CALL_ID}/join`, { location: "SIN" }],
    ]) {
      const r = await videoRequest(intruderToken, method, path, body);
      // Before the grant change a plain "user" can still reach any call; EXPECT_USER_LOCKED=1 after it
      record(`intruder (video role ${role})`, action, r.ok, role === "admin" ? true : expected, r.ok ? "" : `${r.status} ${r.detail}`);
    }
  }

  // Core flows that must keep working
  for (const [who, token, action, method, path, body] of [
    ["owner (call token)", ownerCallToken, "read own call", "GET", `/call/default/${CALL_ID}`],
    ["owner (call token)", ownerCallToken, "join own call", "POST", `/call/default/${CALL_ID}/join`, { location: "SIN" }],
    ["agent (member, user token)", agentUserToken, "join call", "POST", `/call/default/${CALL_ID}/join`, { location: "SIN" }],
  ]) {
    const r = await videoRequest(token, method, path, body);
    record(who, action, r.ok, true, r.ok ? "" : `${r.status} ${r.detail}`);
  }

  // Legacy call (no members): the owner's call token must still work, and the agent must be able to
  // join once the session_started webhook adds it as a member
  const legacyToken = video.generateCallToken({ user_id: OWNER, call_cids: [`default:${LEGACY_CALL_ID}`], exp: exp() });
  const legacyJoin = await videoRequest(legacyToken, "POST", `/call/default/${LEGACY_CALL_ID}/join`, { location: "SIN" });
  record("owner (call token, legacy call)", "join own call", legacyJoin.ok, true, legacyJoin.ok ? "" : `${legacyJoin.status} ${legacyJoin.detail}`);
  await video.video.call("default", LEGACY_CALL_ID).updateCallMembers({ update_members: [{ user_id: AGENT, role: "call_member" }] });
  const legacyAgent = await videoRequest(agentUserToken, "POST", `/call/default/${LEGACY_CALL_ID}/join`, { location: "SIN" });
  record("agent (added as member, legacy call)", "join call", legacyAgent.ok, true, legacyAgent.ok ? "" : `${legacyAgent.status} ${legacyAgent.detail}`);
}

main()
  .catch((e) => console.error("ERROR", e.message ?? e, e.cause?.code ?? e.cause ?? ""))
  .finally(async () => {
    console.table(results);
    // Cleanup: throwaway call, channel and users only
    for (const id of [CALL_ID, LEGACY_CALL_ID]) {
      await video.video.call("default", id).delete({ hard: true }).catch((e) => console.error("cleanup call", e.message));
    }
    await chat.channel("messaging", CHANNEL_ID).delete({ hard_delete: true }).catch((e) => console.error("cleanup channel", e.message));
    await chat.deleteUsers([OWNER, INTRUDER, AGENT], { user: "hard", messages: "hard" }).catch((e) => console.error("cleanup users", e.message));
    const unexpected = results.filter((r) => r.verdict !== "OK").length;
    console.log(results.length === 0 ? "no checks ran" : unexpected === 0 ? "all checks as expected" : `${unexpected} unexpected`);
  });
