/**
 * Severity policy for guard verdicts (decision A1, docs/de-xuat/2026-10-21-chinh-sach-phan-muc-vi-pham.md).
 * - block: cut/refuse, flag the meeting, counts toward kill-switch thresholds
 * - care: self-harm disclosure; the agent keeps talking in a supportive mode, the meeting is not flagged
 * - log: recorded only
 */
export type Severity = "block" | "care" | "log";

const SEVERITY_RANK: Record<Severity, number> = { log: 1, care: 2, block: 3 };

const SELF_HARM = "suicide and self harm";

// Keys are Nemotron category names normalized by `normalizeCategory`
const CATEGORY_SEVERITY: Record<string, Severity> = {
    "violence": "block",
    "sexual": "block",
    "criminal planning/confessions": "block",
    "guns and illegal weapons": "block",
    "controlled/regulated substances": "block",
    [SELF_HARM]: "care",
    "sexual (minor)": "block",
    "hate/identity hate": "block",
    "pii/privacy": "log",
    "harassment": "log",
    "threat": "block",
    "profanity": "log",
    "needs caution": "log",
    "other": "log",
    "manipulation": "log",
    "fraud/deception": "block",
    "malware": "block",
    "high risk gov decision making": "log",
    "political/misinformation/conspiracy": "log",
    "copyright/trademark/plagiarism": "log",
    "unauthorized advice": "log",
    "illegal activity": "block",
    "immoral/unethical": "log",
};

// Taxonomy order from the Nemotron prompt, so "S4" style labels resolve too
const CATEGORY_BY_CODE = Object.keys(CATEGORY_SEVERITY);

// Nemotron often adds these to self-harm disclosures; S6 wins over them unless the content
// also targets other people (threat, hate)
const SELF_HARM_OVERRIDABLE = new Set([
    "violence",
    "criminal planning/confessions",
    "guns and illegal weapons",
    "illegal activity",
]);
const TARGETS_OTHERS = new Set(["threat", "hate/identity hate"]);

/** Jailbreak and prompt-injection attempts are always blocked. */
export const JAILBREAK_SEVERITY: Severity = "block";

/** Nemotron returns names without codes and with varying case, e.g. "Guns and Illegal Weapons". */
export function normalizeCategory(category: string) {
    const name = category.trim().toLowerCase().replace(/\.$/, "");
    const code = name.match(/^s(\d+)$/);
    if (code) {
        return CATEGORY_BY_CODE[Number(code[1]) - 1] ?? name;
    }
    return name.replace(/^s\d+:\s*/, "");
}

export function maxSeverity(severities: (Severity | null)[]): Severity | null {
    return severities.reduce<Severity | null>(
        (max, severity) => (severity && (!max || SEVERITY_RANK[severity] > SEVERITY_RANK[max]) ? severity : max),
        null
    );
}

/**
 * Severity of an unsafe content-safety verdict from its categories. Unknown labels (or none)
 * fall back to "log" with a warning, matching the guard's fail-open stance.
 */
export function categorySeverity(categories: string[]): Severity {
    let names = categories.map(normalizeCategory);

    if (names.includes(SELF_HARM) && !names.some((name) => TARGETS_OTHERS.has(name))) {
        names = names.filter((name) => !SELF_HARM_OVERRIDABLE.has(name));
    }

    const unknown = names.filter((name) => !(name in CATEGORY_SEVERITY));
    if (unknown.length > 0 || names.length === 0) {
        console.warn(`[safety-policy] unknown or missing categories, treated as log: ${JSON.stringify(categories)}`);
    }

    return maxSeverity(names.map((name) => CATEGORY_SEVERITY[name] ?? "log")) ?? "log";
}

/**
 * A block flags the meeting. Self-harm only flags it when the agent produced the harmful
 * content: the user is not a violator, the system is.
 */
export function shouldFlagMeeting(severity: Severity | null, role: "user" | "agent") {
    return severity === "block" || (severity === "care" && role === "agent");
}

/** Appended to the agent's own instructions, so it keeps its persona and language. */
export const REFUSAL_NOTE = `
The user's last message, or your previous reply, was flagged by the safety system.
Briefly and politely say you cannot help with that request, then offer to continue with
another topic. Do not repeat or explain the unsafe content.
`.trim();

/** Enabled once per session after the first self-harm signal. */
export const SUPPORT_NOTE = `
The user may be going through emotional distress or thoughts of self-harm.
Listen, respond with empathy and keep the conversation going naturally; do not switch to a scripted reply.
Gently suggest reaching out to a mental health hotline, a doctor or someone they trust, but mention
it once and do not repeat it in every reply unless the situation gets worse.
Never provide methods, means or encouragement for self-harm or suicide.
`.trim();

/** Used when the agent's own reply was harmful self-harm content and has been cut. */
export const SUPPORT_RETRY_NOTE = `
Your previous reply was cut by the safety system because it could harm a user in distress.
Do not repeat it. Respond supportively instead, following the guidance about emotional distress.
`.trim();
