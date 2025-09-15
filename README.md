# Dad’s Interview Bot

## Mission
Capture family stories with zero friction. Press one big button. Speak. The bot listens patiently, asks thoughtful follow‑ups, and when you’re done it stores the audio and transcripts and emails you links. Sessions are listed in a simple history, with artifacts you can share forever.

This project is optimized for: **patience, simplicity, and durability**.

## What this app does
- **One‑button flow**: Start → speak → think → play reply → continue → finalize.
- **Artifacts**: TXT transcript and JSON transcript; audio plumbing is ready to wire.
- **Email on Done**: Summary email with links (via Resend) to transcript artifacts.
- **History**: See past sessions with quick links.
- **Settings**: Default email and patience knobs (local for now).

## Architecture overview
- **Next.js 14 (App Router)** + **TypeScript** + **Tailwind**.
- **State machine** (Zustand reducer) is the single source of truth for the primary button.
- **Storage**: Vercel Blob for artifacts (public in this build; see Security below).
- **Metadata**: In‑memory for demo; can be replaced with Postgres/Drizzle.
- **Email**: Resend (best‑effort if key exists; otherwise mocked).
- **AI**: OpenAI for follow‑ups (mocked if key missing).

## Quick start (local)
```bash
pnpm install
pnpm dev
# open http://localhost:3000
```
- Without secrets, the app runs in **demo mode** with mocked AI and email and data‑URL artifacts.
- With secrets, artifacts are written to Blob and emails are sent.

## Deploy to Vercel
1. Import this repo.
2. Set Environment Variables (Project Settings → Environment Variables):
```
OPENAI_API_KEY=...
VERCEL_BLOB_READ_WRITE_TOKEN=...
RESEND_API_KEY=...
DEFAULT_NOTIFY_EMAIL=a@sarva.co
NEXT_PUBLIC_APP_NAME=Dad's Interview Bot
AI_PATIENCE_SILENCE_MS=1800
AI_MIN_SPEAKING_GAP_MS=1200
AI_DISABLE_BARGE_IN=true
AI_TTS_VOICE=alloy
```
3. Deploy. This repo includes `vercel.json` so Vercel won’t look for a `dist` folder.

## Routes
- `POST /api/session/start` → `{ id }`
- `POST /api/session/:id/turn` → append a turn `{ role, text, audio_blob_url? }`
- `POST /api/session/:id/finalize` → writes `transcripts/{id}.txt|.json` to Blob; emails links
- `GET /api/history` → list recent sessions (summary)
- `GET /api/health` → Blob & DB health (DB mocked)

## Security & privacy
- **Today**: Artifacts are uploaded as **public** objects for simplicity (easy sharing). For private storage, set Blob access to `private` and serve via a tokenized proxy route (see comments in `lib/blob.ts`). True signed URLs with TTL are recommended for family archives; wire this only after Postgres is added to persist tokens and audit access.
- Minimal PII: only an email address; no analytics.

## Data model (demo)
- Sessions live in an in‑memory map: `{ id, created_at, email_to, status, total_turns, duration_ms, artifacts, turns[] }`.
- Swap in Drizzle/Prisma later; the API contracts are stable.

## Tests
- `pnpm test` runs vitest stubs.
- `pnpm test:ui` contains a Playwright config stub for future smoke tests.

## Known gaps / next steps
- Private Blob + tokenized download proxy.
- Postgres persistence and migrations.
- Streaming audio & STT wiring (Whisper/OpenAI).
- UI polish (help modal, toasts).

## Troubleshooting
- **Vercel error “No Output Directory named 'dist'”**: This repo ships `vercel.json` pointing to `.next` and `next.config.js` with `output: 'standalone'`. Vercel should now detect this as a Next.js app.
- **Emails not received**: Confirm `RESEND_API_KEY` and sender domain.
- **Artifacts missing**: Confirm `VERCEL_BLOB_READ_WRITE_TOKEN` and check `/api/health`.
