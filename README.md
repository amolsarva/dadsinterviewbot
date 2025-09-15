# Dad’s Interview Bot

## Mission
Capture family stories with zero friction. Press one button. The bot listens patiently, nudges with follow‑ups, and emails links to transcripts when you finish. Diagnostics are built in so you can see what’s working.

## TL;DR (New in this build)
- **Diagnostics page** (`/diagnostics`) runs **Health** and **Smoke Test** and prints a copy‑paste log.
- **Health button** is back (header "Help" opens inline tips; Diagnostics link is in nav).
- **Greeting voice**: the app uses the browser’s **SpeechSynthesis** to speak a short welcome.
- **Finalize** writes **TXT** and **JSON** transcripts to Vercel Blob (or data URLs in demo).
- **Email** sent on finalize if `RESEND_API_KEY` is set (best‑effort).

## Run locally
```bash
pnpm install
pnpm dev
# open http://localhost:3000
```
Works in mock mode without secrets.

## Deploy to Vercel
- Repo already includes `vercel.json` (no 'dist' error) and `next.config.js` with `output: 'standalone'`.
- Set envs in Project Settings:
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

## App map
- `/` Home — One big button + **Finish Session** + mini debug log + speaks welcome.
- `/history` — Past sessions, artifact links.
- `/session/[id]` — Detail timeline.
- `/settings` — Default email (localStorage).
- `/diagnostics` — On‑screen **Health** + **Smoke Test** with copyable log.

## API
- `POST /api/session/start` → `{ id }`
- `POST /api/session/:id/turn`
- `POST /api/session/:id/finalize` → writes artifacts + emails
- `GET /api/health` → blob & db status, environment presence, and blob write test
- `POST /api/diagnostics/smoke` → end‑to‑end “create → turn → finalize” test in memory

## Security
- Blob uploads are **public** in this demo. For private archives, switch to `private` and add a signed download proxy (next step).
