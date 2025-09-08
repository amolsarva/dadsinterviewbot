# Dad’s Interview Bot — v3.4
- Robust storage: Blob with fallback to data: URLs (no 500s if Blob token missing).
- In-memory KV fallback when Upstash KV isn’t configured (history/finalize still work).
- Noise-robust VAD, polished UI, Health button bottom-right.


## v3.5 Blob-only mode
- No Upstash/KV dependency. History uses `@vercel/blob` **list()** to enumerate session manifests.
- You only need `BLOB_READ_WRITE_TOKEN` (+ optional Google/SendGrid keys).
