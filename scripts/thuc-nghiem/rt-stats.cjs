// Realtime guard latency and caught_in_time stats from safety_events (read-only).
// Usage (from repo root): node --dns-result-order=ipv4first --env-file=.env scripts/thuc-nghiem/rt-stats.cjs
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/package.json");
const { neon } = req("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const rows = await sql`
    select source, role, detector, count(*)::int n,
      sum(case when unsafe then 1 else 0 end)::int unsafe,
      sum(case when error is not null then 1 else 0 end)::int errors,
      percentile_cont(0.5) within group (order by latency_ms)::int p50,
      percentile_cont(0.9) within group (order by latency_ms)::int p90,
      max(latency_ms) maxms,
      sum(case when caught_in_time then 1 else 0 end)::int caught,
      sum(case when caught_in_time = false then 1 else 0 end)::int late
    from safety_events group by 1,2,3 order by 1,2,3`;
  console.table(rows);
  const unsafeRt = await sql`select role, detector, caught_in_time, latency_ms, categories, left(content,70) c
    from safety_events where source='realtime' and unsafe order by created_at`;
  console.table(unsafeRt);
})();
