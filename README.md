# AI Interview Assistant (Vercel-only)

- Modern UI + brand header
- Logging email moved to bottom, default `a@sarva.co`
- Auto-save after recording stops
- Public history feed (no auth) via `/api/get-history`
- Speaking prompts using the browser's SpeechSynthesis as a simple, deploy-proof default

## Deploy (Vercel)
1) Import as **Vite**.
2) Storage → Blob → Create Store (attach to project).
3) Env Vars (optional for email):
   - `SENDGRID_API_KEY`
   - `FROM_EMAIL`
4) Deploy.

**Note**: I used the Web Speech API for the talking prompts so you don’t hit WS auth issues in browsers. We can later swap to OpenAI Realtime behind a tiny proxy function if you want true AI-generated voice.
