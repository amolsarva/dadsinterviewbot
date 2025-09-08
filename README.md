# Dad’s Interview Bot — v3.10 (Blob-only)
- Node functions only, no Edge, no KV.
- @vercel/blob: uses put() for writes, list({prefix}) for history, JSON fetch for manifests.
- Finalize aggregates turn manifests, computes totals & time bounds, returns emailStatus.
- UI: Done on the far right; ⏭ Next only while listening; History shows all sessions & turns.
