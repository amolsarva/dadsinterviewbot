const required = ['NETLIFY_BLOBS_SITE_ID']
const missing = required.filter((key) => !process.env[key])
if (process.env.STRICT_BLOBS === '1' && missing.length) {
  console.error('Missing required env for STRICT_BLOBS:', missing.join(', '))
  process.exit(1)
}
