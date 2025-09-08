# Dad’s Interview Bot — v2 (fixed build)
- Vite/React frontend
- API routes split runtimes:
  - Edge: `ask-audio`, `get-history`, `health`
  - Node 20: `save-turn`, `finalize-session` (for Buffer and SendGrid library support)
- Vercel Blob + Upstash KV + SendGrid email

## Dev
npm i
npm run dev

## Deploy
Set env vars (see `.env.example`) in Vercel → Settings → Environment Variables.
Push and deploy. Check `/api/health` for env wiring.
