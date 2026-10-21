// Restricts the "user" role of the Stream video call type "default" so that only call members (and the
// owner, through *-owner grants) can access a call. Saves the current grants first; pass --rollback to
// restore them from that backup. See docs/khao-sat/stream-auth.md.
// Usage (from repo root): node --dns-result-order=ipv4first --env-file=.env scripts/thuc-nghiem/stream-restrict-user-role.cjs [--rollback]
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { StreamClient } = createRequire(process.cwd() + "/package.json")("@stream-io/node-sdk");

const BACKUP = path.join(__dirname, "stream-call-type-default-grants.backup.json");

// Kept: grants limited to the caller's own calls, reactions and noise cancellation. Removed: every grant
// that reaches arbitrary calls (join/read/end/list recordings…); members get those through call_member.
const USER_GRANTS = [
  "block-user-owner",
  "create-call-reaction",
  "enable-noise-cancellation-any-team",
  "kick-user-owner",
  "mute-users-owner",
  "pin-call-track-owner",
  "update-call-owner",
  "update-call-permissions-owner",
  "update-call-settings-owner",
];

(async () => {
  const video = new StreamClient(process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY, process.env.STREAM_VIDEO_SECRET_KEY, { timeout: 30000 });
  const current = await video.video.getCallType({ name: "default" });

  if (process.argv.includes("--rollback")) {
    const backup = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
    await video.video.updateCallType({ name: "default", grants: { user: backup.user } });
    console.log("restored user grants from backup");
  } else {
    if (!fs.existsSync(BACKUP)) {
      fs.writeFileSync(BACKUP, JSON.stringify(current.grants, null, 2));
      console.log(`backup written to ${BACKUP}`);
    }
    await video.video.updateCallType({ name: "default", grants: { user: USER_GRANTS } });
    console.log("user grants restricted");
  }

  const after = await video.video.getCallType({ name: "default" });
  for (const role of Object.keys(current.grants)) {
    const same = JSON.stringify([...current.grants[role]].sort()) === JSON.stringify([...after.grants[role]].sort());
    console.log(`${role.padEnd(16)} ${same ? "unchanged" : "CHANGED"} (${after.grants[role].length} grants)`);
  }
  console.log(`user: ${after.grants.user.join(", ")}`);
})().catch((e) => console.error("ERROR", e.message ?? e));
