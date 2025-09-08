# Dad’s Interview Bot — v2.1 polished
- All API routes run on **Edge** (stable):
  - JSON body parsing hardened, base64 decoding without Buffer
  - SendGrid via REST fetch (Edge-compatible)
- Vercel Blob + Upstash KV
- Patient VAD timings, voice end-intent
- UI polish: bigger type, better colors, Done button next to the mic

## Deploy
1) Set env vars in Vercel (see `.env.example`)
2) Push to deploy
3) Check `/api/health`

## Smoke
curl -sS "<your-app>/api/ask-audio?provider=google" -H 'Content-Type: application/json' -d '{"text":"say hello"}'
