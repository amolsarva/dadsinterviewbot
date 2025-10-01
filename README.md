# Dad’s Interview Bot — Drop-in Build (v1.3.1)

This folder is ready to drop into your existing repo and push.

## Interview Guide Prompt
- Use [`docs/interview-guide.md`](docs/interview-guide.md) as the canonical prompt when preparing the bot (or yourself) to run long-form elder interviews. It follows Elizabeth Keating’s *The Essential Questions* structure so you can practice before wiring it into the app.

## Zero-config
- No env vars required. App runs in **demo mode**.
- Artifacts are data URLs (visible in History/Session). Email is skipped gracefully.
- Later, use `.env.local.example` → `.env.local` for real Blob/Email/AI.

## Hosting migration resources
- [Netlify migration checklist](docs/netlify-migration-guide.md) — step-by-step instructions for provisioning Netlify Blobs, wiring secrets, and verifying diagnostics after a deploy.
- [Hosting options after Vercel](docs/hosting-options.md) — side-by-side comparison of Netlify, Cloudflare, Render, AWS Amplify, and Fly.io for this Next.js build.

## Pages
- `/` Home — one-button flow + **Finish Session**, greeting voice, on-screen log.
- `/history`, `/session/[id]`, `/settings`
- `/diagnostics` — Health + Smoke; copyable log for support.

## Known secure-by-default choices
- Blob uploads are public only when a token is present. In demo mode, artifacts are data URLs (private to your browser session).
- No analytics; minimal PII.
