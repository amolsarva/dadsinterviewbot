# Interview App — Realtime Voice (Full + Logging)
- OpenAI Realtime (WebRTC) with mic-first + timeouts
- Mixed recording (user + assistant) saved to Vercel Blob
- Public history list, optional SendGrid emails
- Strong server logging, `OpenAI-Beta: realtime=v1`, 10s server timeout
- Framework preset: **Vite**

## Env Vars
- `OPENAI_API_KEY` (required)
- `SENDGRID_API_KEY` and `FROM_EMAIL` (optional)
