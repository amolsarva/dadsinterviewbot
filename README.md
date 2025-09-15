# Dad's Interview Bot

A one-button, voice-first interview app: press **Start**, speak, the bot listens patiently, asks thoughtful follow-ups, and when you hit **Done** it stores the audio and transcript and emails you links. Deployed on Vercel.

## Quick start

```bash
pnpm install
pnpm dev
# then open http://localhost:3000
```

### Deploy on Vercel
1. Create a new Vercel project and import this repo.
2. Set env vars (see below).
3. Deploy.

## Environment variables

```
OPENAI_API_KEY=
VERCEL_BLOB_READ_WRITE_TOKEN=
POSTGRES_URL=
RESEND_API_KEY=
NEXT_PUBLIC_APP_NAME=Dad's Interview Bot
DEFAULT_NOTIFY_EMAIL=a@sarva.co
AI_PATIENCE_SILENCE_MS=1800
AI_MIN_SPEAKING_GAP_MS=1200
AI_DISABLE_BARGE_IN=true
AI_TTS_VOICE=alloy
```

> Missing envs? The app falls back to in-memory stores and mock AI so you can click through the UI.

## Routes

- `/` — Primary one-button UI with states: Idle → Recording → Thinking → Playing → ReadyToContinue → StartAgain
- `/history` — Past sessions with links
- `/session/[id]` — Session detail
- `/settings` — Email default + patience controls

## Server endpoints

- `POST /api/session/start` — Start a session
- `POST /api/session/[id]/turn` — Append user/assistant turns
- `POST /api/session/[id]/finalize` — Write transcripts, email summary
- `GET  /api/history` — List sessions
- `GET  /api/health` — Check DB + Blob

## Testing

- `pnpm test` — vitest unit tests for state machine
- `pnpm test:ui` — Playwright E2E (basic smoke)

## Notes

- Storage uses Vercel Blob for artifacts; Vercel Postgres optional for metadata (falls back to in-memory if POSTGRES_URL missing).
- Email via Resend; if missing, UI shows a retry banner and logs a warning.
- OpenAI used for STT/TTS/LLM; if missing, uses mock responses.
