import "server-only";
import OpenAI from "openai";

// NVIDIA hosted NIM endpoints are OpenAI-compatible
const nvidia = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
});

const NEMOTRON_MODEL =
    process.env.NEMOTRON_MODEL ?? "nvidia/llama-3.1-nemotron-safety-guard-8b-v3";

// Prompt template from the official model card (Llama-3.1-Nemotron-Safety-Guard-8B-v3)
const buildPrompt = (query: string, response?: string) => `Task: Check if there is unsafe content in the user or agent messages in the below conversation in accordance with our safety policy with the below categories. Provide a 'safe' or 'unsafe' rating for both the user message and the agent response. If there is unsafe content, please also provide a list of violated categories according to our safety policy below.

<BEGIN UNSAFE CONTENT CATEGORIES>
S1: Violence.
S2: Sexual.
S3: Criminal Planning/Confessions.
S4: Guns and Illegal Weapons.
S5: Controlled/Regulated Substances.
S6: Suicide and Self Harm.
S7: Sexual (minor).
S8: Hate/Identity Hate.
S9: PII/Privacy.
S10: Harassment.
S11: Threat.
S12: Profanity.
S13: Needs Caution.
S14: Other.
S15: Manipulation.
S16: Fraud/Deception.
S17: Malware.
S18: High Risk Gov Decision Making.
S19: Political/Misinformation/Conspiracy.
S20: Copyright/Trademark/Plagiarism.
S21: Unauthorized Advice.
S22: Illegal Activity.
S23: Immoral/Unethical.
<END UNSAFE CONTENT CATEGORIES>

<BEGIN CONVERSATION>

user: ${query}
${response ? `\nresponse: agent: ${response}\n` : ""}
<END CONVERSATION>

Provide your safety assessment for the above conversation in the below output JSON format:
{"User Safety": safe or unsafe rating for the user message, "Response Safety": safe or unsafe rating for the agent response. Omit if no agent response present. "Safety Categories": a comma-separated list of applicable safety categories from the provided taxonomy. Omit if all safe.}

Do not include anything other than the output JSON in your response.
Output JSON: `;

export interface SafetyResult {
    userSafe: boolean;
    responseSafe: boolean | null;
    categories: string[];
    latencyMs: number;
    error?: string;
}

/**
 * Classifies a user message (and optionally the agent response) with Nemotron Safety Guard.
 * Fails open: on API or parse errors the content is treated as safe and `error` is set,
 * so the guard never blocks the conversation because of its own outage.
 */
export async function checkSafety({
    query,
    response,
}: {
    query: string;
    response?: string;
}): Promise<SafetyResult> {
    const startedAt = performance.now();

    try {
        const completion = await nvidia.chat.completions.create({
            model: NEMOTRON_MODEL,
            messages: [{ role: "user", content: buildPrompt(query, response) }],
            temperature: 0,
            max_tokens: 100,
        });

        const content = completion.choices[0]?.message?.content ?? "";
        const json = content.match(/\{[\s\S]*\}/)?.[0];
        if (!json) {
            throw new Error(`Unexpected Nemotron output: ${content}`);
        }

        const parsed = JSON.parse(json) as Record<string, string | undefined>;
        const isUnsafe = (value?: string) => value?.trim().toLowerCase() === "unsafe";

        return {
            userSafe: !isUnsafe(parsed["User Safety"]),
            responseSafe: parsed["Response Safety"] === undefined
                ? null
                : !isUnsafe(parsed["Response Safety"]),
            categories: (parsed["Safety Categories"] ?? "")
                .split(",")
                .map((category) => category.trim())
                .filter(Boolean),
            latencyMs: Math.round(performance.now() - startedAt),
        };
    } catch (error) {
        return {
            userSafe: true,
            responseSafe: null,
            categories: [],
            latencyMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
