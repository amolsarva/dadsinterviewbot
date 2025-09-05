# Interview App — Realtime Voice (Connecting Fixes)
- Optimistic button labels and phases: idle → connecting → live → saving.
- Hardened Realtime connection: mic-first, 12s session timeout, clearer errors.
- Mixed recording (user + assistant) saved to Vercel Blob.
- Public history + optional SendGrid emails.
- No `vercel.json`.

## Deploy
1) Vercel preset: **Vite**
2) Storage → **Blob** store attached
3) Env vars: `OPENAI_API_KEY` (required), `SENDGRID_API_KEY` and `FROM_EMAIL` (optional)
4) Deploy, then Start Conversation. If it ever says “Server took too long…”, check Function logs for `/api/realtime-session`.
