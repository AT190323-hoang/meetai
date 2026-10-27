import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { meetings, safetyEvents } from "@/db/schema";
import { checkSafety, type SafetyResult } from "@/lib/nemotron";
import {
    detectJailbreakLLM,
    detectJailbreakNemoGuard,
    type JailbreakResult,
} from "@/lib/jailbreak";
import { detectVnPolicy, type VnPolicyResult } from "@/lib/vn-policy";
import {
    categorySeverity,
    JAILBREAK_SEVERITY,
    maxSeverity,
    shouldFlagMeeting,
    VN_POLICY_SEVERITY,
    VN_UNVERIFIED_SEVERITY,
    type Severity,
} from "@/lib/safety-policy";

export type GuardResult = SafetyResult | JailbreakResult | VnPolicyResult;

const isJailbreakResult = (result: GuardResult): result is JailbreakResult =>
    "jailbreak" in result;

export const isVnPolicyResult = (result: GuardResult): result is VnPolicyResult =>
    "detector" in result && result.detector === "vn_policy";

/** Whether a verdict flags the content; content-safety results are read for the given role. */
export function isUnsafe(result: GuardResult, role: "user" | "agent") {
    if (isJailbreakResult(result)) {
        return result.jailbreak;
    }
    if (isVnPolicyResult(result)) {
        return result.violation || result.unverified;
    }
    return role === "user" ? !result.userSafe : result.responseSafe === false;
}

/** Policy tier of a verdict, or null when it is safe. */
export function severityOf(result: GuardResult, role: "user" | "agent"): Severity | null {
    if (!isUnsafe(result, role)) {
        return null;
    }
    if (isJailbreakResult(result)) {
        return JAILBREAK_SEVERITY;
    }
    if (isVnPolicyResult(result)) {
        return result.violation ? VN_POLICY_SEVERITY : VN_UNVERIFIED_SEVERITY;
    }
    return categorySeverity(result.categories);
}

/**
 * Runs every user-input detector in parallel: Nemotron content safety, both jailbreak detectors
 * (Nemotron Safety Guard does not detect jailbreaks on its own) and the Vietnam content policy.
 * The user message is checked alone: pairing it with an agent reply skews Nemotron's user verdict.
 */
export async function checkUserInput(query: string) {
    const results: GuardResult[] = await Promise.all([
        checkSafety({ query }),
        detectJailbreakNemoGuard(query),
        detectJailbreakLLM(query),
        detectVnPolicy(query),
    ]);

    return {
        results,
        severity: maxSeverity(results.map((result) => severityOf(result, "user"))),
    };
}

/**
 * Checks an agent reply: Nemotron judges it paired with the user's message, the Vietnam content
 * policy judges the reply with the message as context. Only the reply's verdicts are used.
 */
export async function checkAgentReply(query: string, reply: string) {
    const results: GuardResult[] = await Promise.all([
        checkSafety({ query, response: reply }),
        detectVnPolicy(reply, query),
    ]);

    return {
        results,
        severity: maxSeverity(results.map((result) => severityOf(result, "agent"))),
    };
}

/** Category labels stored in safety_events for a verdict. */
function categoriesOf(result: GuardResult) {
    if (isJailbreakResult(result)) {
        return result.jailbreak ? [`Jailbreak${result.technique ? `: ${result.technique}` : ""}`] : [];
    }
    if (isVnPolicyResult(result)) {
        if (result.violation) {
            return [`VN policy${result.type ? `: ${result.type}` : ""}`];
        }
        return result.unverified ? ["VN policy: unverified"] : [];
    }
    return result.categories;
}

/**
 * Persists a guard verdict and flags the meeting when the policy says so (see `shouldFlagMeeting`).
 * Never throws: guard bookkeeping must not break the conversation it is guarding.
 */
export async function recordSafetyEvent({
    meetingId,
    source,
    role,
    content,
    result,
    caughtInTime,
}: {
    meetingId: string;
    source: "realtime" | "chat" | "post_call";
    role: "user" | "agent";
    content: string;
    result: GuardResult;
    caughtInTime?: boolean;
}) {
    const unsafe = isUnsafe(result, role);
    const severity = severityOf(result, role);

    // One retry per write: transient connect timeouts to Neon were observed during calls
    const withRetry = async (write: () => Promise<unknown>) => {
        try {
            await write();
        } catch {
            await write();
        }
    };

    try {
        await withRetry(() => db.insert(safetyEvents).values({
            meetingId,
            source,
            role,
            detector: "detector" in result ? result.detector : "content_safety",
            content,
            unsafe,
            severity,
            categories: categoriesOf(result),
            latencyMs: result.latencyMs,
            caughtInTime,
            error: result.error,
        }));

        if (shouldFlagMeeting(severity, role)) {
            await withRetry(() => db
                .update(meetings)
                .set({ safetyStatus: "flagged" })
                .where(eq(meetings.id, meetingId)));
        }
    } catch (error) {
        console.error(`[safety] failed to record event for meeting ${meetingId}`, error);
    }
}

/** Whether the meeting has a self-harm signal, so stateless handlers can stay in supportive mode. */
export async function hasCareSignal(meetingId: string) {
    try {
        const [row] = await db
            .select({ id: safetyEvents.id })
            .from(safetyEvents)
            .where(and(eq(safetyEvents.meetingId, meetingId), eq(safetyEvents.severity, "care")))
            .limit(1);
        return row !== undefined;
    } catch (error) {
        console.error(`[safety] failed to read care signal for meeting ${meetingId}`, error);
        return false;
    }
}

/**
 * Who caused a meeting's flag: the user (any blocked user turn) or otherwise the agent. The UI
 * words the warning differently, since an agent-caused flag is not the user's violation.
 */
export async function getFlagCause(meetingId: string): Promise<"user" | "agent"> {
    const [userBlock] = await db
        .select({ id: safetyEvents.id })
        .from(safetyEvents)
        .where(and(
            eq(safetyEvents.meetingId, meetingId),
            eq(safetyEvents.role, "user"),
            eq(safetyEvents.severity, "block"),
        ))
        .limit(1);
    return userBlock ? "user" : "agent";
}

/**
 * Atomically counts a blocked user turn and returns the new total, or null when the write fails
 * (the caller then falls back to its in-memory count).
 */
export async function incrementBlockedTurns(meetingId: string) {
    try {
        const [row] = await db
            .update(meetings)
            .set({ blockedTurns: sql`${meetings.blockedTurns} + 1` })
            .where(eq(meetings.id, meetingId))
            .returning({ blockedTurns: meetings.blockedTurns });
        return row?.blockedTurns ?? null;
    } catch (error) {
        console.error(`[safety] failed to count blocked turn for meeting ${meetingId}`, error);
        return null;
    }
}

/** Records every result of a `checkUserInput` call. */
export function recordUserInputEvents(
    params: Omit<Parameters<typeof recordSafetyEvent>[0], "role" | "result">,
    results: GuardResult[]
) {
    return Promise.all(
        results.map((result) => recordSafetyEvent({ ...params, role: "user", result }))
    );
}
