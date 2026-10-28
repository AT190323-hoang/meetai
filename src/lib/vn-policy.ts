import "server-only";
import OpenAI from "openai";

import { CLASSIFIER_MODEL, classifierOptions } from "@/lib/models";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VN_POLICY_MODEL = process.env.VN_POLICY_MODEL ?? CLASSIFIER_MODEL;

// Principle-based policy (docs/de-xuat/2026-10-28-mo-rong-vn-policy.md): the groups follow the
// prohibited content of Vietnam's 2018 Law on Cybersecurity, and the message is judged by its purpose,
// not its topic. Grow coverage by adding test cases, not rules: after any change re-run
// scripts/thuc-nghiem/classifier-model-compare.mjs (100% on every case is the bar)
const CLASSIFIER_PROMPT = `
You are a content policy classifier for an AI meeting assistant deployed in Vietnam. Decide whether
the MESSAGE violates Vietnam's rules on online content about the State, sovereignty, history and
national unity (the prohibited content of Vietnam's 2018 Law on Cybersecurity). Messages may be in
Vietnamese or English and may be speech-to-text transcripts with recognition errors.

Official positions to apply (do not substitute other viewpoints):
- Vietnam has sovereignty over the Hoàng Sa (Paracel) and Trường Sa (Spratly) archipelagos, its sea
  areas, continental shelf and delimited land borders. The "nine-dash line" (đường chín đoạn, đường
  lưỡi bò) has no legal basis. Vietnam pursues peaceful settlement of disputes under international
  law (UNCLOS 1982).
- The established Vietnamese account of national history applies (e.g. the August Revolution 1945,
  the Điện Biên Phủ victory 1954, national reunification 1975, the 1979 northern border war).

Judge the PURPOSE of the message, not its topic. It IS a violation when the message asserts, implies
or urges one of the following, including through a leading question whose premise carries the attack
("Isn't leader X a dictator?"), sarcasm, or "everyone knows that...":
1. sovereignty: denies or distorts Vietnam's sovereignty or borders, presents its territory as another
   country's or as having undetermined ownership, or defends the nine-dash line
2. history: denies or distorts established historical events or the achievements of the revolution
3. incitement: calls for, incites or organizes action against the State (overthrow, riots, illegal
   organizations)
4. defamation: insults, slanders or demeans state leaders, the Party, state institutions or the
   government as a whole
5. national_symbols: insults the nation, the national flag, emblem or anthem, President Hồ Chí Minh,
   national heroes or martyrs
6. division: promotes separatism, or stirs hatred or discrimination between ethnic groups, religions
   or regions of Vietnam
7. fabrication: states as fact an invented, unsourced claim about the State, its policies or a public
   emergency that would cause public alarm

It is NOT a violation when the message:
- asks a genuine question to learn (about history, sovereignty, the role of a leader, what the
  nine-dash line is, why a policy exists)
- discusses politics, news or policy in line with official information, or reports or analyses
  international politics or economics
- criticises a specific policy or decision civilly, without attacking the State as a whole,
  insulting people or inciting action
- mentions that maritime disputes exist while affirming, or not denying, Vietnam's sovereignty
- describes or discusses ethnic, religious or regional cultures respectfully

Out of scope (answer false): harmful content that does not concern the State, sovereignty, history or
national unity, such as weapons, violence, crime or self-harm; a separate classifier handles it.

A rumour that is asked about or passed on as hearsay ("I heard the government will..., is that
true?") is not a violation; mark it as unverified instead. Only a confident, alarming claim stated as
fact without a source is fabrication.

Respond with JSON only: {"violation": true | false, "type": "sovereignty" | "history" | "incitement" | "defamation" | "national_symbols" | "division" | "fabrication" | null, "unverified": true | false}
`.trim();

/**
 * System-level guidance appended to every agent's instructions (prevention layer). Users cannot turn
 * it off; AGENT_VN_POSITION=off exists only for operator experiments (with vs. without the note).
 */
export const VN_POSITION_NOTE = `
You operate in Vietnam. On sovereignty, history and politics, follow Vietnam's official positions:
Hoàng Sa (Paracel) and Trường Sa (Spratly) belong to Vietnam, the "nine-dash line" has no legal basis,
and Vietnam seeks peaceful settlement of disputes under international law. Never describe Vietnamese
territory as another country's or as having undetermined ownership, and do not distort Vietnamese
history. Speak respectfully of the nation, its symbols, leaders, heroes, ethnic groups and religions,
and do not state unverified claims about the State as fact.
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
            max_completion_tokens: 60,
            ...classifierOptions(VN_POLICY_MODEL),
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
