const DEFAULT_USER_ID = 'default'

export function normalizeUserId(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return DEFAULT_USER_ID
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_USER_ID
  const lowered = trimmed.toLowerCase()
  const cleaned = lowered.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned || DEFAULT_USER_ID
}

export function buildUserScopedPath(userId: string, suffix: string): string {
  const normalized = normalizeUserId(userId)
  const trimmedSuffix = suffix.startsWith('/') ? suffix.slice(1) : suffix
  return `users/${normalized}/${trimmedSuffix}`
}

export { DEFAULT_USER_ID }
