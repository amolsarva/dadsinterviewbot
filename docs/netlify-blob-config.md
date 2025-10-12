# Netlify Blob Storage Configuration Checklist

Use this walkthrough to verify the blob configuration items that cause 405 errors when uploads run from the app. Complete each step in order so you know the store and site wiring all match.

## 1. Confirm the blob store exists and matches the configured name
1. Sign in to [Netlify](https://app.netlify.com/) and open your team dashboard.
2. In the global navigation, choose **Storage** ➜ **Blobs**. (If the Storage item is hidden, open **Team settings** first, then choose **Storage** from the left-hand sidebar.)
3. Locate the store named `dads-interview-bot`. If it is missing, click **Create blob store**, enter `dads-interview-bot`, and finish the wizard. If you already use a different store name, note the exact value—you must copy it into `NETLIFY_BLOBS_STORE`.
4. When the store is present, open it and copy its **Store name** and **Store ID** for reference.

## 2. Let Netlify inject the blob credentials automatically
1. Delete any `NETLIFY_BLOBS_TOKEN` you previously defined in the Netlify UI. The runtime now asks Netlify to inject an internal JWT during each request, so manual tokens are no longer necessary for app-managed writes.
2. Keep `NETLIFY_BLOBS_STORE` (if you override the default) and `NETLIFY_BLOBS_SITE_ID` configured as before. These settings still inform the runtime which store and site to target.
3. Only generate a personal access token if you need to write to Blobs from an external script or CLI. In that case you can continue to create a token with **Blobs: Read and write** scope and use it with the Netlify REST API instead of the in-app SDK.

## 3. Link the site ID
1. From the Netlify dashboard, open the **Sites** tab and select the site that hosts this app.
2. On the site overview page, scroll to **Site information** and expand it to reveal the **API ID** (UUID). This is Netlify’s canonical Site ID.
3. Copy the API ID and set it as `NETLIFY_BLOBS_SITE_ID` in your environment. Using the UUID skips the slug lookup path that requires additional REST permissions.
4. If you can only supply a site slug, keep `NETLIFY_BLOBS_SITE_SLUG` populated *and* temporarily define a `NETLIFY_BLOBS_TOKEN` with Sites API scope. The runtime needs it only long enough to resolve the slug to a UUID; once the diagnostics confirm the canonical Site ID you can remove the token again.

## 4. Validate optional URL overrides (if any)
1. Only follow this step if you have provided `NETLIFY_BLOBS_EDGE_URL`, `NETLIFY_BLOBS_API_URL`, or similar overrides.
2. In the blob store view from step 1, check the **Region** value. Netlify uses different base URLs per region.
3. Compare the region to the override values you have set. Confirm the hostnames point to the same region as your store. In particular, do **not** send writes to `https://netlify-blobs.netlify.app`; that domain serves cached reads only. For upload operations, rely on `NETLIFY_BLOBS_API_URL=https://api.netlify.com/api/v1/blobs` (the default) and remove the edge override unless Netlify support instructs otherwise.
4. After adjusting overrides, redeploy the environment so the updated settings apply.

## 5. Ensure Next.js API routes deploy on Netlify
1. Confirm the repository includes a `netlify.toml` with the Next.js build command, `.next` publish directory, and the `@netlify/plugin-nextjs` entry. Without the plugin the App Router API endpoints (such as `/api/diagnostics`) are never compiled into Netlify Functions, yielding 404 responses in production.
2. After pushing configuration changes, trigger a fresh deploy and inspect the build logs. Look for `Framework detected: Next.js` and the Netlify adapter’s summary of generated API routes. If the log instead reports a static build, delete any conflicting build settings in the Netlify UI and redeploy.
3. When the deploy finishes, run `netlify functions:list` or open the deploy summary and confirm functions like `api_diagnostics` exist. Their presence verifies Netlify can execute your in-app diagnostics suite.

## 6. Confirm the deployment context in diagnostics
1. Open the in-app **Diagnostics** page and run the full suite.
2. In the log viewer, find the `***KEY NETFLIFY ITEMS***` block. It now repeats the store/token/site wiring and lists the detected deployment origin and URL so you can verify you are exercising the intended test release (for example, `https://dadsbot.netlify.app`).
3. If the deployment origin or URL do not match the environment you expected, re-run the tests from the correct host before continuing troubleshooting.

## After completing the checklist
Redeploy the site (or trigger the failing tests again) to confirm blob uploads now succeed. If 405 errors persist, recheck the store name, token scope, and site ID for typographical errors, then contact Netlify support with the failing request ID shown in the diagnostics.
