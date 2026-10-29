# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Meet.AI: a Next.js 15 (App Router) app where users create AI "agents" (a name plus system instructions) and run video meetings with them. An OpenAI Realtime agent (`gpt-realtime-2.1`) joins the Stream Video call. After the call ends, the transcript is summarized in Vietnamese by `gpt-6.1-terra` in the background, and users can chat with the agent about the meeting. Free-tier limits and subscriptions go through Polar.

## Project context and working agreement

This repo is the user's graduation thesis (Học viện Kỹ thuật Mật mã, An toàn thông tin): "AI Agent hội thoại video thời gian thực tích hợp cơ chế kiểm duyệt nội dung". There is no fixed deadline right now; the user will say when there is one. The user communicates in Vietnamese; reply in Vietnamese. Prefer work that produces thesis evidence (measurements for Chapter 3), and flag any mismatch between the thesis text and the code.

At the start of a session, read `docs/van-de-mo.md` (open decisions, next tasks) and the newest file in `docs/nhat-ky/` to see where work stopped.

Big features follow `docs/quy-trinh-lam-viec.md`: survey (read-only) → proposal and plan, then **stop for the user's approval** → build in small slices → the user runs real calls/UI tests while you prepare the test script and analyze logs → update docs → commit/push only after the user agrees. When the user says "tạm dừng" or "ghi lại để bàn sau", record the item in `docs/van-de-mo.md` and wait for "làm tiếp".

- Do not decide the pending questions in `docs/van-de-mo.md` section A on your own; raise them for discussion. Decided policies live in `docs/de-xuat/` (severity tiers A1, multi-turn context A4: keep per-turn checks, kill-switch/quarantine A5, deployment A3: whole app on AWS EC2, done last; A2: the product runs one fixed guard mode, strict with a 2 s timeout (decided 28/10), and users never choose it); follow them when implementing.
- Branches: `29-finish` is the integration (dev) branch. Big features go on `feat/<name>` branched from `29-finish` and merge back into it; small fixes and docs go straight onto `29-finish`. Never merge into `main` unless the user says it is ready to deploy: Vercel deploys `main` to production. Merge `main` back into `29-finish` whenever `main` changes.
- Thesis `.docx`/`.pdf` files in `docs/` are gitignored (the repo is public). The user keeps them in cloud storage, so they may be missing from a fresh clone.

## Commands

```bash
npm run dev          # Next dev server on http://localhost:3000
npm run build        # production build (also runs type-check)
npm run lint         # next lint (ESLint 9, eslint-config-next)
npm run db:push      # push src/db/schema.ts to Postgres (no migration files are used)
npm run db:studio    # Drizzle Studio
npm run dev:webhook  # ngrok tunnel to :3000 so Stream webhooks reach local dev (domain is hardcoded; change it to your own)
npx inngest-cli dev  # Inngest dev server (not in package.json); needed for post-meeting processing
```

There is no test framework and there are no tests.

Required env vars (`.env`): `DATABASE_URL` (Neon Postgres), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_STREAM_VIDEO_API_KEY`, `STREAM_VIDEO_SECRET_KEY`, `NEXT_PUBLIC_STREAM_CHAT_API_KEY`, `STREAM_CHAT_SECRET_KEY`, `OPENAI_API_KEY`, `POLAR_ACCESS_TOKEN`, `NVIDIA_API_KEY`, `PII_ENCRYPTION_KEY` (base64 of 32 random bytes; copy it to every deployment, losing it makes masked values unrecoverable) (optional overrides: `NVIDIA_BASE_URL`, `NEMOTRON_MODEL`, and the OpenAI models in `src/lib/models.ts`: `REALTIME_MODEL`, `CHAT_MODEL`, `SUMMARY_MODEL`, plus `JAILBREAK_CLASSIFIER_MODEL`, `VN_POLICY_MODEL`). The user's speech in calls is transcribed with `TRANSCRIPTION_MODEL` = `gpt-transcribe` (`language: vi`, no prompt; it beat gpt-4o-mini-transcribe 0.9% vs 17.1% word errors, `docs/khao-sat/stt.md`). Every OpenAI model the app used until 10/2026 (gpt-realtime, gpt-4o, gpt-4o-mini) is shut down in January 2027; see `docs/khao-sat/doi-model.md`.

## Architecture

### Feature modules
`src/app/` holds only routing and thin page wrappers. Real code lives in `src/modules/<feature>/`:
- `server/procedures.ts`: the tRPC router for that feature, registered in `src/trpc/routers/_app.ts` (`agents`, `meetings`, `premium`)
- `ui/views/`: full-page views, typically exporting `XView`, `XViewLoading`, `XViewError`
- `ui/components/`, `hooks/`, `schemas.ts` (zod), `types.ts`, `params.ts` (nuqs search-param definitions)

`src/components/ui/` contains shadcn components (`components.json`). `@/*` maps to `src/*`.

### Data-fetching pattern
Server page components check the session with `auth.api.getSession({ headers: await headers() })` and redirect to `/sign-in` if needed. They parse filters with the module's nuqs `loadSearchParams`, call `getQueryClient().prefetchQuery(trpc.<router>.<proc>.queryOptions(...))` from `@/trpc/server`, and wrap the client view in `HydrationBoundary` + `Suspense` + `ErrorBoundary`. Client views use `useSuspenseQuery` with the same query options from `@/trpc/client`, so filter params must match between server and client.

### tRPC procedures (`src/trpc/init.ts`)
- `protectedProcedure`: requires a better-auth session; puts it on `ctx.auth`
- `premiumProcedure("agents" | "meetings")`: extends `protectedProcedure`. It looks up the Polar customer by `externalId = user.id` and throws `FORBIDDEN` when the free limit is reached (`MAX_FREE_AGENTS`/`MAX_FREE_MEETINGS` in `src/modules/premium/constants.ts`) and there is no active subscription. Used for `create` mutations.
- List procedures use shared pagination constants from `@/constants`.

### Auth and payments
`src/lib/auth.ts` sets up better-auth with the Drizzle adapter (email/password plus GitHub and Google) and the Polar plugin, which creates a Polar customer on sign-up and adds checkout and portal endpoints. Auth tables (`user`, `session`, `account`, `verification`) sit in `src/db/schema.ts` alongside `agents` and `meetings`. Agent IDs and meeting IDs are nanoids.

### Stream access control
Chat and video share one Stream app. Users are upserted with role `user` (never `admin`: it can read, write and delete every chat and delete calls/recordings). `meetings.generateToken({ meetingId })` checks ownership and returns a call token scoped to `default:<meetingId>`; `generateChatToken` returns a token that expires in an hour; `prepareChatChannel` creates the meeting's chat channel server side after an ownership check, and the client only watches it. The `user` role of the `default` call type was restricted on 21/10 (`scripts/thuc-nghiem/stream-restrict-user-role.cjs`, backup + `--rollback`), so call access comes only from membership: always pass `role: "call_member"` when adding members (without it the member gets the global `user` role and is denied). The chat webhook answers only the meeting owner. `scripts/thuc-nghiem/stream-access-check.cjs` verifies all of this with throwaway users. Details: `docs/khao-sat/stream-auth.md`.

### Meeting lifecycle
Meeting `status` enum: `upcoming → active → processing → completed` (or `cancelled`).

1. `meetings.create` inserts the row, upserts the owner and the agent as Stream users, and creates a Stream call `("default", meetingId)` with both as `call_member`s, `custom.meetingId`, auto transcription and recording.
2. `/call/[meetingId]` joins the call using a call token from `meetings.generateToken({ meetingId })`.
3. `src/app/api/webhook/route.ts` receives Stream webhooks, verifies their signature, and drives state:
   - `call.session_started`: status becomes `active`, then `startAgentSession` (`src/lib/agent-session.ts`) connects the agent (`connectOpenAi`) with its `instructions`, the transcript recorder and the realtime guard (`src/lib/realtime-guard.ts`). If the agent's connection drops while the call is live and the kill-switch has not fired, it reconnects (up to 3 tries, 5 per call) with the recent Vietnamese transcript as context; if it cannot, it ends the call. `scripts/thuc-nghiem/agent-reconnect-check.ts <agentId>` checks this on a throwaway call. The guard never sends while disconnected (timers can fire after a drop). The guard runs in parallel: it classifies user and agent transcripts via `src/lib/nemotron.ts` and on an unsafe verdict cancels the response and makes the agent refuse. Never send `response.cancel` without an active response: the Stream realtime wrapper disconnects the agent on any server `error` event. `@stream-io/openai-realtime-api` must stay at ≥0.4 (it speaks the GA Realtime protocol). With 0.3.x, which uses the beta protocol, every `session.update` fails with "Missing required parameter: 'session.type'". `@stream-io/node-sdk` must be ≥0.7.62, because older versions declare a peer of openai-realtime-api ≤0.3 and `npm install` fails with ERESOLVE. `drizzle-orm` ≥0.45 declares optional React Native peers that make some `npm install <pkg>` runs fail with ERESOLVE; use `--legacy-peer-deps` for that one command (plain `npm install` works). Dependency audit status: `docs/khao-sat/npm-audit.md`. The client sends its full default session config on every `updateSession`, including `turn_detection: null`, so always pass `turn_detection` explicitly. Without it VAD is off and the agent never replies. GA event names are `response.output_audio_transcript.*`, not `response.audio_transcript.*`. `next.config.ts` sets `serverExternalPackages` for `ws`, because bundling it breaks `connectOpenAi` with "bufferUtil.mask is not a function".
   - `call.session_participant_left`: ends the call when the **user** leaves; the agent leaving does not (it is reconnected)
   - `call.session_ended`: status becomes `processing`
   - `call.transcription_ready`: saves `transcriptUrl` and sends the Inngest event `meetings/processing`
   - `call.recording_ready`: saves `recordingUrl`
   - `message.new` (Stream Chat, channel id = meeting id, completed meetings only): replies as the agent using OpenAI with the meeting summary and recent messages as context
4. `src/inngest/functions.ts` (served at `/api/inngest`): two functions listen to `meetings/processing`:
   - `meetingsProcessing` summarizes the Vietnamese transcript recorded in the call (`getRealtimeTranscript`), or Stream's JSONL transcript (an English translation, Stream has no Vietnamese) when there is none; it maps `speaker_id` to names, summarizes in Vietnamese with `@inngest/agent-kit` (`SUMMARY_MODEL`), skips empty transcripts, saves `summary`, and sets status to `completed`.
   - `meetingsSafetyAudit` pairs user and agent turns of **Stream's** transcript (kept on purpose: an independent transcription catches what the realtime one misheard), classifies them, and sets `meetings.safetyStatus` to `safe` unless it is already `flagged`.

### Vietnamese transcript
`src/lib/transcript-recorder.ts` (attached next to the guard, listen-only, never sends to the session) writes `transcript_items`: user lines from the realtime transcription, agent replies when their audio stops (`output_audio_buffer.started/stopped`; Stream's proxy does not forward audio deltas). A cancelled reply is cut to played time × the measured speech rate and marked `interrupted`. `getRealtimeTranscript` (`src/lib/transcript.ts`) merges consecutive lines of one speaker; `meetings.getTranscript` and the summary prefer it over Stream's. Self-check without a call: `npx tsx --conditions=react-server --env-file=.env scripts/thuc-nghiem/transcript-recorder-check.ts <meetingId>`.

### Personal data
`src/lib/pii.ts` finds phone numbers, emails, ID, card (Luhn) and account numbers (not names or addresses). Transcript lines are stored with a marker per value (`src/lib/pii-marker.ts`) and the values AES-256-GCM encrypted in `transcript_items.pii`; the UI shows a blurred stand-in and `meetings.revealPii` returns the value to the owner of a non-quarantined meeting, logging each reveal in `pii_reveals`. `safety_events`, `guard_turns` and summaries keep only labels (`labelPii`). The guard itself reads the clear text. Self-check: `npx tsx --conditions=react-server scripts/thuc-nghiem/pii-check.ts`. Details: `docs/de-xuat/2026-10-28-an-danh-pii.md`. Details: `docs/khao-sat/vn-transcript.md`.

### Safety guard (NVIDIA Nemotron)
Nemotron Safety Guard classifies harmful content but does **not** detect jailbreaks. NemoGuard JailbreakDetect (`src/lib/jailbreak.ts`) only catches long English template prompts. For that reason, user input goes through `checkUserInput`, which runs four detectors in parallel: content safety, `jailbreak_nemoguard`, `jailbreak_llm` (an LLM classifier, `CLASSIFIER_MODEL` = gpt-5.6-luna with reasoning off, that also handles short and Vietnamese attempts), and `vn_policy` (`src/lib/vn-policy.ts`, an LLM classifier on the same model for Vietnam's content rules, which Nemotron cannot judge: 7 principles following the prohibited content of the 2018 Law on Cybersecurity — sovereignty incl. the nine-dash line, history, incitement, defamation incl. leading questions, national symbols, division, fabrication stated as fact — judged by purpose, not topic; hearsay asked about is only `unverified`). Grow its coverage by adding cases to the test set, not rules to the prompt. Agent replies go through `checkAgentReply`: content safety (paired with the user message) plus `vn_policy`. A reply that only breaks `vn_policy` is corrected, not refused. `withVnPositionNote` appends a system-level note on Vietnam's official positions to every agent's instructions; users cannot remove it (`AGENT_VN_POSITION=off` is for experiments only). After changing either classifier prompt or model, re-run `scripts/thuc-nghiem/classifier-model-compare.mjs` (reads the prompts from the code; 100% on every case is the bar). Reasoning models need `max_completion_tokens` (not `max_tokens`) and reject `temperature: 0` unless reasoning is `none`; use `classifierOptions`.

Guard modes (A2, decided 28/10): the product runs **strict**; `REALTIME_GUARD=shadow` (experiments only) makes the agent answer at once while the guard cuts in on a block. Strict sets `turn_detection.create_response: false`, so the guard decides when the agent answers: the first `block` verdict refuses at once, a cleared turn is answered (care turns switch to supportive mode first), and after `GUARD_STRICT_TIMEOUT_MS` (2000) the agent answers anyway and the guard continues as shadow. In strict mode never send `response.create` while a response is active or requested (`responseRequested`), and do not answer a turn while the user is speaking again (VAD splits sentences at pauses). VAD silence is `VAD_SILENCE_MS` (900; the 500 ms default split 17 sentences into 40 turns). Fragments starting within 2.5 s of the previous one are one utterance: the guard checks the joined text, counts a block once per utterance, and the recorder writes one line (so personal data spoken across fragments is masked). `scripts/thuc-nghiem/guard-grouping-check.ts <agentId>` replays the 29/10 failure cases through the real guard. Every user turn's timing goes to `guard_turns` (transcription, guard, end of speech to the agent's first words); `scripts/thuc-nghiem/guard-turns-stats.cjs` summarizes it per mode. `REALTIME_GUARD=off` disables the guard. The Stream server clients use a 15 s timeout (the SDK's 3 s default made the kill-switch's `call.end()` fail); the kill-switch retries `call.end()` and falls back to disconnecting the agent.

Unsafe verdicts are mapped to a policy tier by `src/lib/safety-policy.ts` (decision A1): `block` (cut/refuse, flag), `care` (self-harm: the user is not cut off; the session switches once to a supportive mode; only harmful self-harm content from the agent is cut and flags the meeting), `log` (record only). Guard notes are appended to the agent's own instructions, never replace them. Check the user message alone (`checkUserInput`); pairing it with the agent reply skews Nemotron's user verdict, so the pair is only used to judge the reply. In calls, each reply is paired with the user turn it answers (snapshotted at `response.created`), not the latest transcript. When that user turn was blocked, a content-safety `block` on the reply is only logged (`agentReplySeverity`): it is almost always the opening line of a refusal read against the harmful request, the guard already refuses, and the meeting must not be flagged as the agent's fault (`docs/khao-sat/agent-false-positive.md`). When the user turn is `care` or not judged yet, the first content-safety block on a reply is deferred and acted on only if it holds on more of the reply: the opening line of a supportive reply is blocked like a harmful one (labels included, Nemotron returns one label list for the pair), the full supportive reply is not (`care-reply-check.mjs`). The post-call audit checks **user turns only**: Stream's English re-transcription of the agent produced false flags, and the agent's exact text is already checked in the call. `npx tsx scripts/thuc-nghiem/policy-check.ts` self-checks the policy.

Every verdict (realtime, chat, post-call) goes through `recordSafetyEvent` (`src/lib/safety-events.ts`). It writes a row to `safety_events` with its `severity` and sets `meetings.safetyStatus` to `flagged` per `shouldFlagMeeting`. `checkSafety` fails open: if the API errors, the content is treated as safe and the `error` column is filled in. The chat handler in the webhook blocks before and after GPT by tier (`CHAT_REFUSAL`, or supportive guidance / `CHAT_SUPPORT_REPLY` for `care`).

Kill-switch and quarantine (decision A5): blocked user turns are counted in `meetings.blocked_turns`; at `SAFETY_WARN_AT` (5) the refusal warns, one turn before `SAFETY_KILL_AT` (10) it warns finally, at `SAFETY_KILL_AT` the agent says a closing line and `call.end()` ends the call. A flagged meeting is quarantined until the owner calls `meetings.acknowledgeSafety`: `getOne` blanks summary/transcript/recording and returns `quarantined` + `flaggedBy`, `getTranscript`/`getSafetyEvents` are forbidden, `getMany` never returns content. Chat for flagged meetings is locked for good (`CHAT_LOCKED`), because the summary in its prompt may carry injected content.

Running the full flow locally requires the ngrok tunnel (Stream must be configured to send webhooks to it) and the Inngest dev server.

### Project docs
`docs/` holds the project documentation in Vietnamese:
- architecture: `kien-truc-tong-quan.md`
- safety guard design and measurements: `safety-guard.md`
- open issues and pending decisions: `van-de-mo.md`
- proposed workflow: `quy-trinh-lam-viec.md`
- session logs: `nhat-ky/`

Keep these docs updated alongside code changes.

### Misc
- `next.config.ts` redirects `/` to `/meetings`.
- Avatars are generated with DiceBear (`src/lib/avatar.tsx`).
