export const SESSION_STORAGE_BASE_KEY = 'sessionId'
export const EMAIL_STORAGE_BASE_KEY = 'defaultEmail'
export const EMAIL_ENABLED_STORAGE_BASE_KEY = 'sendSummaryEmails'
export const DEMO_HISTORY_BASE_KEY = 'demoHistory'
export const ACTIVE_USER_HANDLE_STORAGE_KEY = 'activeUserHandle'
export const DEFAULT_NOTIFY_EMAIL = 'a@sarva.co'

const DEFAULT_SCOPE_KEY = '__default__'

export function normalizeHandle(handle?: string | null): string | undefined {
  if (!handle) return undefined
  if (typeof handle !== 'string') return undefined
  const trimmed = handle.trim()
  if (!trimmed.length) return undefined
  return trimmed.toLowerCase()
}

export function deriveUserScopeKey(handle?: string | null): string {
  return normalizeHandle(handle) ?? DEFAULT_SCOPE_KEY
}

export function scopedStorageKey(base: string, handle?: string | null): string {
  const normalized = normalizeHandle(handle)
  return normalized ? `${base}:${normalized}` : base
}
