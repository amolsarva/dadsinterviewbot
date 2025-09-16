# Dad’s Interview Bot — Drop-in Build (v1.3.1)

This folder is ready to drop into your existing repo and push.

## Zero-config
- No env vars required. App runs in **demo mode**.
- Artifacts are data URLs (visible in History/Session). Email is skipped gracefully.
- Later, use `.env.local.example` → `.env.local` for real Blob/Email/AI.

## Pages
- `/` Home — one-button flow + **Finish Session**, greeting voice, on-screen log.
- `/history`, `/session/[id]`, `/settings`
- `/diagnostics` — Health + Smoke; copyable log for support.

## Known secure-by-default choices
- Blob uploads are public only when a token is present. In demo mode, artifacts are data URLs (private to your browser session).
- No analytics; minimal PII.
