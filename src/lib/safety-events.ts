import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { meetings, safetyEvents } from "@/db/schema";
import { checkSafety, type SafetyResult } from "@/lib/nemotron";
import {
    detectJailbreakLLM,
    detectJailbreakNemoGuard,
    type JailbreakResult,
} from "@/lib/jailbreak";

type GuardResult = SafetyResult | JailbreakResult;

const isJailbreakResult = (result: GuardResult): result is JailbreakResult =>
    "detector" in result;

/** Whether a verdict flags the content; content-safety results are read for the given role. */
export function isUnsafe(result: GuardResult, role: "user" | "agent") {
    if (isJailbreakResult(result)) {
        return result.jailbreak;
    }
    return role === "user" ? !result.userSafe : result.responseSafe === false;
}

/**
 * Runs every user-input detector in parallel: Nemotron content safety plus both jailbreak
 * detectors (Nemotron Safety Guard does not detect jailbreaks on its own).
 */
export async function checkUserInput(query: string) {
    const results: GuardResult[] = await Promise.all([
        checkSafety({ query }),
        detectJailbreakNemoGuard(query),
        detectJailbreakLLM(query),
    ]);

    return {
        results,
        unsafe: results.some((result) => isUnsafe(result, "user")),
    };
}

/**
 * Persists a guard verdict and flags the meeting when the content is unsafe.
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
    const jailbreak = isJailbreakResult(result);

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
            detector: jailbreak ? result.detector : "content_safety",
            content,
            unsafe,
            categories: jailbreak
                ? (result.jailbreak ? [`Jailbreak${result.technique ? `: ${result.technique}` : ""}`] : [])
                : result.categories,
            latencyMs: result.latencyMs,
            caughtInTime,
            error: result.error,
        }));

        if (unsafe) {
            await withRetry(() => db
                .update(meetings)
                .set({ safetyStatus: "flagged" })
                .where(eq(meetings.id, meetingId)));
        }
    } catch (error) {
        console.error(`[safety] failed to record event for meeting ${meetingId}`, error);
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
