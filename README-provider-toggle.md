# Dad's Interview Bot — Provider Toggle Build (Google Gemini default, OpenAI optional)

This build keeps **both** providers and adds a UI toggle to switch between **Google (Gemini)** and **OpenAI** at runtime.

- Default provider: **Google**
- Toggle in UI (top-right): shows current provider and lets you switch.
- Server routes:
  - `POST /api/ask-audio?provider=google|openai`  → unified schema `{ ok, text, audio?, format? }`
  - `GET /api/health`  → checks env + simple call for each provider
- We **did not** remove OpenAI code. It’s just one branch of the same handler.

## Env Vars (Vercel → Settings → Environment Variables)
- `PROVIDER` (optional): `google` or `openai` (default `google`)
- `GOOGLE_API_KEY`: required for Google Gemini branch (get from Google AI Studio)
- `OPENAI_API_KEY`: required for OpenAI branch
- Optional (OpenAI): `ASK_MODEL` (default `gpt-4o`)
- Optional (Google): `GOOGLE_MODEL` (default `gemini-1.5-flash`)

## Notes
- For now, the app sends **text-only** to either provider. This isolates quota/config issues.
- When OpenAI quota + access are sorted, we can upgrade the OpenAI branch to audio-in/out.
- API handlers are **Node.js serverless** style (`(req, res)`), matching Vercel's Node runtime.
- All calls return a consistent JSON shape, so the UI doesn’t care which provider is active.
