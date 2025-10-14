const REQUIRED = [
  'NETLIFY_BLOBS_API_URL',
  'NETLIFY_BLOBS_SITE_ID',
  'NETLIFY_BLOBS_STORE',
  'NETLIFY_BLOBS_TOKEN',
] as const

type RequiredKey = (typeof REQUIRED)[number]

function coerceBoolean(value: string | undefined | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

export function isForceProdBlobsEnabled(): boolean {
  return coerceBoolean(process.env.FORCE_PROD_BLOBS)
}

function maskValue(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  if (trimmed.length <= 8) return trimmed
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

export function snapshotRequiredBlobEnv(): Record<RequiredKey, string | undefined> {
  return REQUIRED.reduce<Record<RequiredKey, string | undefined>>((acc, key) => {
    const raw = process.env[key]
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      acc[key] = trimmed.length ? trimmed : undefined
    } else {
      acc[key] = undefined
    }
    return acc
  }, {} as Record<RequiredKey, string | undefined>)
}

export function describeBlobEnvSnapshot(
  snapshot: Record<RequiredKey, string | undefined> = snapshotRequiredBlobEnv(),
) {
  return {
    NETLIFY_BLOBS_API_URL: snapshot.NETLIFY_BLOBS_API_URL || null,
    NETLIFY_BLOBS_SITE_ID: maskValue(snapshot.NETLIFY_BLOBS_SITE_ID),
    NETLIFY_BLOBS_STORE: snapshot.NETLIFY_BLOBS_STORE || null,
    NETLIFY_BLOBS_TOKEN: snapshot.NETLIFY_BLOBS_TOKEN
      ? `${snapshot.NETLIFY_BLOBS_TOKEN.length} chars`
      : null,
    FORCE_PROD_BLOBS: isForceProdBlobsEnabled(),
  }
}

export function assertBlobEnv() {
  const snapshot = snapshotRequiredBlobEnv()
  const missing = REQUIRED.filter((key) => !snapshot[key])
  console.log('[BLOBS ENV]', describeBlobEnvSnapshot(snapshot))
  if (missing.length) throw new Error('Missing blob env: ' + missing.join(', '))
}
