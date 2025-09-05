# Interview App — Realtime Voice (Fixed Build)
- OpenAI Realtime (WebRTC) with proper JS syntax in `src/realtime-webrtc.js`
- Mixed recording (user + assistant) auto-saves to Vercel Blob
- Public history + optional SendGrid email
- No `vercel.json`

## Deploy
- Framework Preset: **Vite**
- Attach a **Blob** store
- Env Vars: `OPENAI_API_KEY` (required), `SENDGRID_API_KEY` + `FROM_EMAIL` (optional)
