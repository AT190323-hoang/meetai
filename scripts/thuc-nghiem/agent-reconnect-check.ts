// Checks that a dropped agent is reconnected while the call is live, and not after it ended
// (src/lib/agent-session.ts). Uses a temporary meeting row and Stream call (deleted afterwards) with
// an existing user and agent. The drop is caused the way it happens in calls: a client event the
// server rejects makes the Stream wrapper disconnect.
// Usage (from repo root):
//   npx tsx --conditions=react-server --env-file=.env scripts/thuc-nghiem/agent-reconnect-check.ts <agentId>
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { startAgentSession } from "@/lib/agent-session";
import { streamVideo } from "@/lib/stream-video";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    const [agent] = await db.select().from(agents).where(eq(agents.id, process.argv[2]));
    if (!agent) throw new Error("agent not found");
    const meetingId = `reconnect-test-${nanoid(6)}`;
    const startedAt = new Date();
    const call = streamVideo.video.call("default", meetingId);
    const logs: string[] = [];
    const original = console.log;
    const errors = console.error;

    // Everything after the insert is inside try: a failed step must not leave the row behind
    // (a network error once left an "active" meeting in the owner's list)
    try {
        await db.insert(meetings).values({ id: meetingId, name: "reconnect test", userId: agent.userId, agentId: agent.id, status: "active", startedAt });
        await call.create({ data: { created_by_id: agent.userId, members: [{ user_id: agent.userId, role: "call_member" }, { user_id: agent.id, role: "call_member" }] } });

        console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); original(...args); };
        console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); errors(...args); };

        const client = await startAgentSession({ meetingId, ownerId: agent.userId, agent, callStartedAt: startedAt });
        await wait(3000);
        original("--- causing a drop: response.cancel with no active response");
        client.realtime.send("response.cancel", {});
        // The dev machine's network sometimes stalls ~12 s, so wait for the new session up to 30 s
        const attachedTwice = () => logs.filter((line) => line.includes("attached (")).length >= 2;
        for (let waited = 0; waited < 30000 && !attachedTwice(); waited += 500) {
            await wait(500);
        }
        const reconnected = logs.some((line) => line.includes("reconnecting (attempt 1/"));

        original("--- ending the call: the agent must not come back");
        await db.update(meetings).set({ status: "processing" }).where(eq(meetings.id, meetingId));
        await call.end();
        const before = logs.filter((line) => line.includes("reconnecting")).length;
        await wait(12000);
        const after = logs.filter((line) => line.includes("reconnecting")).length;

        console.log = original;
        console.error = errors;
        for (const [name, ok] of [
            ["dropped agent reconnected", reconnected],
            ["guard attached again on the new session", attachedTwice()],
            ["no reconnect after the call ended", after === before],
        ] as const) original(ok ? "PASS" : "FAIL", name);
    } finally {
        console.log = original;
        console.error = errors;
        await call.end().catch(() => {});
        await call.delete({ hard: true }).catch(() => {});
        await db.delete(meetings).where(eq(meetings.id, meetingId)).catch(() =>
            original(`could not delete test meeting ${meetingId}; remove it by hand`));
        process.exit(0);
    }
})();
