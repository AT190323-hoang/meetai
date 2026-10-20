# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Meet.AI: a Next.js 15 (App Router) app where users create AI "agents" (a name plus system instructions) and run video meetings with them. An OpenAI Realtime agent joins the Stream Video call. After the call ends, the transcript is summarized by GPT-4o in the background, and users can chat with the agent about the meeting. Free-tier limits and subscriptions go through Polar.

## Project context and working agreement

This repo is the user's graduation thesis (Học viện Kỹ thuật Mật mã, An toàn thông tin): "AI Agent hội thoại video thời gian thực tích hợp cơ chế kiểm duyệt nội dung". The report deadline is **31/10/2026**. The user communicates in Vietnamese; reply in Vietnamese. Prefer work that produces thesis evidence (measurements for Chapter 3), and flag any mismatch between the thesis text and the code.

At the start of a session, read `docs/van-de-mo.md` (open decisions, next tasks) and the newest file in `docs/nhat-ky/` to see where work stopped.

Big features follow `docs/quy-trinh-lam-viec.md`: survey (read-only) → proposal and plan, then **stop for the user's approval** → build in small slices → the user runs real calls/UI tests while you prepare the test script and analyze logs → update docs → commit/push only after the user agrees. When the user says "tạm dừng" or "ghi lại để bàn sau", record the item in `docs/van-de-mo.md` and wait for "làm tiếp".

- Do not decide the pending policy questions in `docs/van-de-mo.md` section A (severity tiers such as PII block vs log-only, strict mode, multi-turn context) on your own; raise them for discussion.
- Work on feature branches and push only those. Do not merge into `main`: Vercel deploys `main` to production.
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

### Meeting lifecycle
Meeting `status` enum: `upcoming → active → processing → completed` (or `cancelled`).

1. `meetings.create` inserts the row and creates a Stream call `("default", meetingId)` with `custom.meetingId`, auto transcription and recording. It also upserts the agent as a Stream user.
2. `/call/[meetingId]` joins the call using a token from `meetings.generateToken`.
3. `src/app/api/webhook/route.ts` receives Stream webhooks, verifies their signature, and drives state:
   - `call.session_started`: status becomes `active`, then `connectOpenAi` attaches the agent with its `instructions` and the Nemotron realtime guard (`src/lib/realtime-guard.ts`). The guard runs in parallel: it classifies user and agent transcripts via `src/lib/nemotron.ts` and on an unsafe verdict cancels the response and makes the agent refuse. Never send `response.cancel` without an active response: the Stream realtime wrapper disconnects the agent on any server `error` event. `@stream-io/openai-realtime-api` must stay at ≥0.4 (it speaks the GA Realtime protocol). With 0.3.x, which uses the beta protocol, every `session.update` fails with "Missing required parameter: 'session.type'". The client sends its full default session config on every `updateSession`, including `turn_detection: null`, so always pass `turn_detection` explicitly. Without it VAD is off and the agent never replies. GA event names are `response.output_audio_transcript.*`, not `response.audio_transcript.*`. `next.config.ts` sets `serverExternalPackages` for `ws`, because bundling it breaks `connectOpenAi` with "bufferUtil.mask is not a function".
   - `call.session_participant_left`: ends the call
   - `call.session_ended`: status becomes `processing`
   - `call.transcription_ready`: saves `transcriptUrl` and sends the Inngest event `meetings/processing`
   - `call.recording_ready`: saves `recordingUrl`
   - `message.new` (Stream Chat, channel id = meeting id, completed meetings only): replies as the agent using OpenAI with the meeting summary and recent messages as context
4. `src/inngest/functions.ts` (served at `/api/inngest`): two functions listen to `meetings/processing`:
   - `meetingsProcessing` fetches the JSONL transcript, maps `speaker_id` to user and agent names, summarizes with `@inngest/agent-kit` (gpt-4o), saves `summary`, and sets status to `completed`.
   - `meetingsSafetyAudit` pairs user and agent turns, classifies them with Nemotron, and sets `meetings.safetyStatus` to `safe` unless it is already `flagged`.

### Safety guard (NVIDIA Nemotron)
Nemotron Safety Guard classifies harmful content but does **not** detect jailbreaks. NemoGuard JailbreakDetect (`src/lib/jailbreak.ts`) only catches long English template prompts. For that reason, user input goes through `checkUserInput`, which runs three detectors in parallel: content safety, `jailbreak_nemoguard`, and `jailbreak_llm` (a gpt-4o-mini classifier that also handles short and Vietnamese attempts). Agent output goes through content safety only.

Every verdict (realtime, chat, post-call) goes through `recordSafetyEvent` (`src/lib/safety-events.ts`). It writes a row to `safety_events` and sets `meetings.safetyStatus` to `flagged` when the content is unsafe. `checkSafety` fails open: if the API errors, the content is treated as safe and the `error` column is filled in. The chat handler in the webhook blocks before and after GPT and replies with `CHAT_REFUSAL`.

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
