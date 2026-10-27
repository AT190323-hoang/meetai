// OpenAI models used by the app; each can be overridden by env to compare models in experiments.
// The previous ones (gpt-realtime, gpt-4o) are shut down in January 2027 (docs/khao-sat/doi-model.md).

/** Voice agent in the call */
export const REALTIME_MODEL = process.env.REALTIME_MODEL ?? "gpt-realtime-2.1";

/** Post-meeting chat; a low reasoning effort keeps replies fast */
export const CHAT_MODEL = process.env.CHAT_MODEL ?? "gpt-6.1-terra";
export const CHAT_REASONING_EFFORT = "low" as const;

/** Meeting summary (runs in the background, so the default reasoning effort is kept) */
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "gpt-6.1-terra";
