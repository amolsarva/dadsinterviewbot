# Supabase storage setup

The app can run entirely in memory, but production deployments should point at a Supabase
Storage bucket so session recordings persist between restarts. This guide captures the
minimum configuration and how to confirm everything is healthy.

## 1. Create the storage bucket
1. Create (or reuse) a Supabase project.
2. Open **Storage → Buckets → New bucket** and create a bucket for interview artifacts.
   * Any name works; we typically use something like `interviews`.
   * Leave the bucket **Public** so the app can render links immediately. Private buckets
     still work, but users will receive signed download URLs instead of direct public links.
3. No SQL migrations are required—the REST storage API is used directly.

## 2. Gather the required environment variables
Add the following keys to Vercel (or your local `.env` when testing):

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | Copy from Supabase **Project Settings → API → Project URL**. |
| `SUPABASE_SERVICE_ROLE_KEY` | Preferred because the app occasionally deletes files and lists folders. The code will also accept `SUPABASE_SECRET_KEY` or `SUPABASE_ANON_KEY`, but those lack the permissions to clean up history. |
| `SUPABASE_STORAGE_BUCKET` | The bucket name you created above. (`SUPABASE_BUCKET` is accepted as an alias.) |

Only these three are required for storage. (Other features such as OpenAI or email rely on
separate keys listed in `ENV_KEYS.txt`.)

## 3. Optional security tightening
If you do not want a public bucket, you can mark it private and still use the same
configuration. The app automatically generates signed download URLs when public access is not
available.

## 4. Health and diagnostics checks
Once the environment variables are set and the deployment restarts, the app exposes two quick
checks:

* **Homepage badge.** The hero card now shows the detected storage provider and whether the
  last health probe succeeded.
* **API endpoints.**
  * `GET /api/health` → includes a `storage` block summarizing configuration state.
  * `GET /api/diagnostics/storage` → runs an explicit bucket list call and returns any error
    message.

You can hit these endpoints from a browser or `curl` to verify the bucket credentials. The
Diagnostics page in the app also surfaces these responses.

## 5. Automated coverage
`tests/blob.test.ts` exercises the Supabase upload path (with a mocked client) and the
in-memory fallback. While we do not run these tests in the container by default, they ensure
that credential detection and the Supabase client wiring remain intact.
