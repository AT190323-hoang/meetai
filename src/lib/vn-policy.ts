import "server-only";
import OpenAI from "openai";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VN_POLICY_MODEL = process.env.VN_POLICY_MODEL ?? "gpt-4o-mini";

// Policy text measured in docs/khao-sat/vn-policy.md (18/18 user, 5/5 agent); re-run
// scripts/thuc-nghiem/vn-policy-survey.mjs after changing it
const CLASSIFIER_PROMPT = `
You are a content policy classifier for an AI meeting assistant deployed in Vietnam. Decide whether
the MESSAGE violates Vietnam's content rules on sovereignty, history and politics. Messages may be in
Vietnamese or English and may be speech-to-text transcripts with recognition errors.

Official positions to apply (do not substitute other viewpoints):
- Vietnam has sovereignty over the Hoàng Sa (Paracel) and Trường Sa (Spratly) archipelagos. Vietnam
  pursues peaceful settlement of disputes under international law (UNCLOS 1982).
- The established Vietnamese account of national history applies (e.g. the August Revolution 1945,
  the Điện Biên Phủ victory 1954, national reunification 1975, the 1979 northern border war).

It IS a violation when the message:
- denies or distorts Vietnam's sovereignty over Hoàng Sa, Trường Sa or other territory, including
  presenting them as another country's territory or as having undetermined ownership
- denies or distorts established historical events
- calls for, incites or organizes actions against the State (overthrow, riots, illegal organizations)
- insults or defames state leaders or state institutions

It is NOT a violation when the message:
- discusses politics, news or policy in line with official information and Vietnam's positions
- reports or analyses international politics or economics
- asks factual questions about history, sovereignty or politics
- expresses a civil opinion or criticism of a specific policy without inciting action against the
  State or insulting leaders
- mentions that maritime disputes exist while affirming, or not denying, Vietnam's sovereignty

Out of scope (answer false): harmful content that does not concern the State, sovereignty or history,
such as weapons, violence, crime or self-harm; a separate classifier handles it.

A message that repeats an unverified rumour about the government ("I heard the government will...")
is not a violation; mark it as unverified instead.

Respond with JSON only: {"violation": true | false, "type": "sovereignty" | "history" | "incitement" | "defamation" | null, "unverified": true | false}
`.trim();

/**
 * System-level guidance appended to every agent's instructions (prevention layer). Users cannot turn
 * it off; AGENT_VN_POSITION=off exists only for operator experiments (with vs. without the note).
 */
export const VN_POSITION_NOTE = `
You operate in Vietnam. On sovereignty, history and politics, follow Vietnam's official positions:
Hoàng Sa (Paracel) and Trường Sa (Spratly) belong to Vietnam, and Vietnam seeks peaceful settlement of
disputes under international law. Never describe them as another country's territory or as having
undetermined ownership, and do not distort Vietnamese history.
`.trim();

export function withVnPositionNote(instructions: string) {
    return process.env.AGENT_VN_POSITION === "off" ? instructions : `${instructions}\n\n${VN_POSITION_NOTE}`;
}

/** Used when the agent's own reply broke the policy and has been cut. */
export const VN_CORRECTION_NOTE = `
Your previous reply did not follow Vietnam's official positions on sovereignty, history or politics.
Do not repeat it. Briefly correct it in line with those positions, then continue the conversation.
`.trim();

export interface VnPolicyResult {
    detector: "vn_policy";
    violation: boolean;
    type: string | null;
    // Unverified rumours about the government are logged, not blocked
    unverified: boolean;
    latencyMs: number;
    error?: string;
}

/**
 * Classifies a user message, or an agent reply when `query` (the user's message) is given as context.
 * Fails open like the other detectors: outages never block the conversation.
 */
export async function detectVnPolicy(message: string, query?: string): Promise<VnPolicyResult> {
    const startedAt = performance.now();
    const input = query === undefined
        ? `MESSAGE (from the user): ${message}`
        : `User (context only): ${query}\nMESSAGE (the assistant's reply): ${message}`;

    try {
        const completion = await openaiClient.chat.completions.create({
            model: VN_POLICY_MODEL,
            messages: [
                { role: "system", content: CLASSIFIER_PROMPT },
                { role: "user", content: input },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 60,
        });

        const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
            violation?: boolean;
            type?: string | null;
            unverified?: boolean;
        };
        const violation = parsed.violation === true;
        return {
            detector: "vn_policy",
            violation,
            // The model sometimes returns the string "null"
            type: violation && parsed.type && parsed.type !== "null" ? parsed.type : null,
            unverified: !violation && parsed.unverified === true,
            latencyMs: Math.round(performance.now() - startedAt),
        };
    } catch (error) {
        return {
            detector: "vn_policy",
            violation: false,
            type: null,
            unverified: false,
            latencyMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
