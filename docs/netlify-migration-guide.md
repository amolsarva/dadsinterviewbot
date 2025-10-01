# Netlify migration checklist

This project already builds with `next build`/`next start` and exposes every server feature through App Router routes, so Netlify can host it without changing the runtime. Follow this checklist whenever you move a fresh environment to Netlify so audio storage, email, and the diagnostics dashboard all stay healthy.

## 1. Prepare the repository
- Commit the `netlify.toml` at the project root:
  ```toml
  [build]
    command = "npm run build"
    publish = ".next"

  [[plugins]]
    package = "@netlify/plugin-nextjs"
  ```
- Verify that `package.json` still exposes `build`/`start` scripts—Netlify drives them automatically.

## 2. Create the Netlify site
- In Netlify → **Add new site from Git**, point to this repo and track the `main` branch.
- Enable **Deploy Previews** if you want per-PR URLs. Netlify will build every push automatically once the connection is live.

## 3. Wire Supabase storage
1. In [Supabase](https://supabase.com/), create (or reuse) a project and add a storage bucket for the transcripts + primers (defaults to `dads-interview-bot`).
2. From **Project settings → API**, copy the **Project URL** and the **service_role** key.
3. In Netlify **Site settings → Environment variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STORAGE_BUCKET`
   - Optional overrides if you proxy downloads: `SUPABASE_PUBLIC_BASE_URL` or `BLOB_PUBLIC_BASE_URL`.
   - Already have them saved as `NETLIFY_SUPABASE_*`, `NETLIFY_ENV_SUPABASE_*`, or legacy `NEXT_PUBLIC_SUPABASE_*` keys? Leave them; the runtime reads those aliases automatically but still prefers the service-role secret.

> Without these Supabase values the runtime falls back to the in-memory store. Diagnostics will warn with `mode: "memory"` until you add the secrets and redeploy.

## 4. Wire the AI + email providers
Add any production credentials you use today:
- `OPENAI_API_KEY` (enables real assistant follow-ups)
- `RESEND_API_KEY` or `SENDGRID_API_KEY` (controls outbound summary mail)
- `DEFAULT_NOTIFY_EMAIL` (defaults to `a@sarva.co` if omitted)
- UI niceties such as `NEXT_PUBLIC_APP_NAME` are optional.

## 5. Deploy and validate
1. Trigger a deployment by pushing to `main` or pressing **Deploy site**.
2. Once Netlify finishes, visit `/diagnostics` on the deployed URL.
3. Confirm all checks read `ok: true`:
   - **Storage** should now report `mode: "supabase"` with your bucket name.
   - **OpenAI** and **Google** should echo the model IDs you configured.
   - **Smoke/E2E** tests should return emailed sessions and artifact links.
4. Hop back to the home page — the runtime badge under the hero will call out the storage provider + bucket and links to diagnostics, so you can spot misconfigured secrets instantly.
5. Record a short session and open **History** to make sure audio URLs resolve (they should use `/api/blob/...` with a 200 response).

## 6. Rotate tokens safely
- Supabase service keys can be rotated without downtime: add the new key in the Netlify UI first, redeploy, then delete the old key.
- Track rotation cadence in `ToDoLater.txt` (see the existing reminder) so the credentials never stale out.

## 7. Troubleshooting quick hits
- **Storage still in memory** → double-check that `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` are defined for the *production* context and that the latest deploy pulled them in (`Deploy settings → Environment`).
- **Blob downloads 404** → ensure the bucket name matches the one you configured; wrong names silently point to an empty bucket.
- **Diagnostics missing OpenAI/Google** → Netlify hides secrets from build logs; verify they exist via the dashboard and re-run the deploy. The `/api/health` endpoint echoes which providers are active.

Following this checklist keeps feature parity with the old Vercel deployment while preserving the in-memory fallback for local demos.
