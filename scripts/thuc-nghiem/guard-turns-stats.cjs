// Shadow vs strict comparison from the guard_turns table (A2 survey): per mode, how each user turn
// was decided and where the time went. Read-only.
// Usage (from repo root):
//   node --dns-result-order=ipv4first --env-file=.env scripts/thuc-nghiem/guard-turns-stats.cjs [meetingId ...]
const { createRequire } = require("module");
const { neon } = createRequire(process.cwd() + "/package.json")("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

const pct = (xs, p) => {
  const s = xs.filter((x) => x !== null).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};

(async () => {
  const ids = process.argv.slice(2);
  const rows = ids.length
    ? await sql`select * from guard_turns where meeting_id = any(${ids}) order by created_at`
    : await sql`select * from guard_turns order by created_at`;
  if (!rows.length) return console.log("no guard_turns rows yet");

  console.table(rows.map((r) => ({
    meeting: r.meeting_id.slice(0, 6), mode: r.mode, decision: r.decision, severity: r.severity ?? "-",
    stt_ms: r.transcription_ms, guard_ms: r.guard_ms, start_ms: r.response_start_ms, text: r.content.slice(0, 40),
  })));

  const summary = [];
  for (const mode of ["shadow", "strict"]) {
    const m = rows.filter((r) => r.mode === mode);
    if (!m.length) continue;
    const count = (d) => m.filter((r) => r.decision === d).length;
    summary.push({
      mode,
      turns: m.length,
      decided_before_timeout: mode === "strict" ? `${m.length - count("timeout")}/${m.length}` : "-",
      blocked_first: mode === "strict" ? count("block") : "-",
      stt_p50: pct(m.map((r) => r.transcription_ms), 0.5), stt_p90: pct(m.map((r) => r.transcription_ms), 0.9),
      guard_p50: pct(m.map((r) => r.guard_ms), 0.5), guard_p90: pct(m.map((r) => r.guard_ms), 0.9),
      // End of the user's speech to the agent's first words: the delay the user feels
      start_p50: pct(m.map((r) => r.response_start_ms), 0.5), start_p90: pct(m.map((r) => r.response_start_ms), 0.9),
    });
  }
  console.table(summary);
})();
