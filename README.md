# Dad’s Interview Bot — Full v3
- Vite/React frontend with patient state machine, polished UI, Done/Start Again, History modal.
- All API routes run on **Node runtime** (no Edge bundling issues).
- Storage: Vercel Blob for audio + manifests; Upstash KV for session index.
- Email: SendGrid REST on finalize.

## Deploy
1) Set env vars in Vercel (see `.env.example`).
2) Push and deploy.
3) Visit `/api/health` to confirm env wiring.
