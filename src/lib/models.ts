// OpenAI models used by the app; each can be overridden by env to compare models in experiments.
// The previous ones (gpt-realtime, gpt-4o) are shut down in January 2027 (docs/khao-sat/doi-model.md).

/** Voice agent in the call */
export const REALTIME_MODEL = process.env.REALTIME_MODEL ?? "gpt-realtime-2.1";

/** Post-meeting chat; a low reasoning effort keeps replies fast */
export const CHAT_MODEL = process.env.CHAT_MODEL ?? "gpt-6.1-terra";
export const CHAT_REASONING_EFFORT = "low" as const;

/** Meeting summary (runs in the background, so the default reasoning effort is kept) */
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "gpt-6.1-terra";

/**
 * jailbreak_llm and vn_policy. gpt-5.6-luna matched gpt-4o-mini's accuracy on every test case and was
 * the fastest replacement that did (scripts/thuc-nghiem/classifier-model-compare.mjs); their latency
 * bounds the realtime guard, so reasoning is off.
 */
export const CLASSIFIER_MODEL = "gpt-5.6-luna";

/** Request options for a classifier model: reasoning models need it turned off to stay fast. */
export const classifierOptions = (model: string) =>
    model.startsWith("gpt-4") ? {} : { reasoning_effort: "none" as const };

/**
 * The user's speech in the call, read by the guard and kept as the Vietnamese transcript.
 * gpt-transcribe: 0.9% word errors vs 17.1% for gpt-4o-mini-transcribe, no output in other scripts
 * and no safety keyword lost (scripts/thuc-nghiem/stt-compare.mjs, docs/khao-sat/stt.md). A context
 * prompt is not used: it made gpt-4o-mini-transcribe write the prompt itself on unclear audio.
 */
export const TRANSCRIPTION_MODEL = process.env.TRANSCRIPTION_MODEL ?? "gpt-transcribe";
