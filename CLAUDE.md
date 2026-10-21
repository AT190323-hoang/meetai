# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Meet.AI: a Next.js 15 (App Router) app where users create AI "agents" (a name plus system instructions) and run video meetings with them. An OpenAI Realtime agent joins the Stream Video call. After the call ends, the transcript is summarized by GPT-4o in the background, and users can chat with the agent about the meeting. Free-tier limits and subscriptions go through Polar.

## Project context and working agreement

This repo is the user's graduation thesis (Học viện Kỹ thuật Mật mã, An toàn thông tin): "AI Agent hội thoại video thời gian thực tích hợp cơ chế kiểm duyệt nội dung". There is no fixed deadline right now; the user will say when there is one. The user communicates in Vietnamese; reply in Vietnamese. Prefer work that produces thesis evidence (measurements for Chapter 3), and flag any mismatch between the thesis text and the code.

At the start of a session, read `docs/van-de-mo.md` (open decisions, next tasks) and the newest file in `docs/nhat-ky/` to see where work stopped.

Big features follow `docs/quy-trinh-lam-viec.md`: survey (read-only) → proposal and plan, then **stop for the user's approval** → build in small slices → the user runs real calls/UI tests while you prepare the test script and analyze logs → update docs → commit/push only after the user agrees. When the user says "tạm dừng" or "ghi lại để bàn sau", record the item in `docs/van-de-mo.md` and wait for "làm tiếp".

- Do not decide the pending questions in `docs/van-de-mo.md` section A (currently which single guard mode the product uses, shadow or strict; it is being surveyed) on your own; raise them for discussion. Decided policies live in `docs/de-xuat/` (severity tiers A1, multi-turn context A4: keep per-turn checks, kill-switch/quarantine A5, deployment A3: whole app on AWS EC2, done last; the product runs one fixed guard mode and users never choose it, A2); follow them when implementing.
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

Required env vars (`.env`): `DATABASE_URL` (Neon Postgres), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_STREAM_VIDEO_API_KEY`, `STREAM_VIDEO_SECRET_KEY`, `NEXT_PUBLIC_STREAM_CHAT_API_KEY`, `STREAM_CHAT_SECRET_KEY`, `OPENAI_API_KEY`, `POLAR_ACCESS_TOKEN`, `NVIDIA_API_KEY` (optional overrides: `NVIDIA_BASE_URL`, `NEMOTRON_MODEL`).

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
   - `call.session_started`: status becomes `active`, then `connectOpenAi` attaches the agent with its `instructions` and the Nemotron realtime guard (`src/lib/realtime-guard.ts`). The guard runs in parallel: it classifies user and agent transcripts via `src/lib/nemotron.ts` and on an unsafe verdict cancels the response and makes the agent refuse. Never send `response.cancel` without an active response: the Stream realtime wrapper disconnects the agent on any server `error` event. `@stream-io/openai-realtime-api` must stay at ≥0.4 (it speaks the GA Realtime protocol). With 0.3.x, which uses the beta protocol, every `session.update` fails with "Missing required parameter: 'session.type'". `@stream-io/node-sdk` must be ≥0.7.62, because older versions declare a peer of openai-realtime-api ≤0.3 and `npm install` fails with ERESOLVE. The client sends its full default session config on every `updateSession`, including `turn_detection: null`, so always pass `turn_detection` explicitly. Without it VAD is off and the agent never replies. GA event names are `response.output_audio_transcript.*`, not `response.audio_transcript.*`. `next.config.ts` sets `serverExternalPackages` for `ws`, because bundling it breaks `connectOpenAi` with "bufferUtil.mask is not a function".
   - `call.session_participant_left`: ends the call
   - `call.session_ended`: status becomes `processing`
   - `call.transcription_ready`: saves `transcriptUrl` and sends the Inngest event `meetings/processing`
   - `call.recording_ready`: saves `recordingUrl`
   - `message.new` (Stream Chat, channel id = meeting id, completed meetings only): replies as the agent using OpenAI with the meeting summary and recent messages as context
4. `src/inngest/functions.ts` (served at `/api/inngest`): two functions listen to `meetings/processing`:
   - `meetingsProcessing` fetches the JSONL transcript, maps `speaker_id` to user and agent names, summarizes with `@inngest/agent-kit` (gpt-4o), saves `summary`, and sets status to `completed`.
   - `meetingsSafetyAudit` pairs user and agent turns, classifies them with Nemotron, and sets `meetings.safetyStatus` to `safe` unless it is already `flagged`.

### Safety guard (NVIDIA Nemotron)
Nemotron Safety Guard classifies harmful content but does **not** detect jailbreaks. NemoGuard JailbreakDetect (`src/lib/jailbreak.ts`) only catches long English template prompts. For that reason, user input goes through `checkUserInput`, which runs four detectors in parallel: content safety, `jailbreak_nemoguard`, `jailbreak_llm` (a gpt-4o-mini classifier that also handles short and Vietnamese attempts), and `vn_policy` (`src/lib/vn-policy.ts`, a gpt-4o-mini classifier for Vietnam's content rules on sovereignty, history and politics, which Nemotron cannot judge). Agent replies go through `checkAgentReply`: content safety (paired with the user message) plus `vn_policy`. A reply that only breaks `vn_policy` is corrected, not refused. `withVnPositionNote` appends a system-level note on Vietnam's official positions to every agent's instructions; users cannot remove it (`AGENT_VN_POSITION=off` is for experiments only). After changing the `vn_policy` prompt, re-run `scripts/thuc-nghiem/vn-policy-survey.mjs`.

Unsafe verdicts are mapped to a policy tier by `src/lib/safety-policy.ts` (decision A1): `block` (cut/refuse, flag), `care` (self-harm: the user is not cut off; the session switches once to a supportive mode; only harmful self-harm content from the agent is cut and flags the meeting), `log` (record only). Guard notes are appended to the agent's own instructions, never replace them. Check the user message alone (`checkUserInput`); pairing it with the agent reply skews Nemotron's user verdict, so the pair is only used to judge the reply. `npx tsx scripts/thuc-nghiem/policy-check.ts` self-checks the policy.

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
