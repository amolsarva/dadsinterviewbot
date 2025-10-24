const formatEnvSummary = () => ({
  NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL: process.env.NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL ?? null,
  DEFAULT_NOTIFY_EMAIL: process.env.DEFAULT_NOTIFY_EMAIL ?? null,
})

const logDiagnostic = (level: 'log' | 'error', message: string, detail?: unknown) => {
  const timestamp = new Date().toISOString()
  const scope = '[user-scope]'
  const payload = { env: formatEnvSummary(), detail }
  if (level === 'error') {
    console.error(`[diagnostic] ${timestamp} ${scope} ${message}`, payload)
  } else {
    console.log(`[diagnostic] ${timestamp} ${scope} ${message}`, payload)
  }
}

const resolvedDefaultNotifyEmail = (() => {
  const fromPublic = (process.env.NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL ?? '').trim()
  const fromServer = (process.env.DEFAULT_NOTIFY_EMAIL ?? '').trim()

  if (!fromPublic) {
    const message =
      'NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL is required for client defaults but was not provided.'
    logDiagnostic('error', message)
    throw new Error(message)
  }

  if (fromPublic === 'a@sarva.co') {
    const message =
      'NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL is using the placeholder fallback value and must be configured.'
    logDiagnostic('error', message)
    throw new Error(message)
  }

  if (!fromServer) {
    logDiagnostic('error', 'DEFAULT_NOTIFY_EMAIL is missing on the server environment.')
  } else if (fromServer !== fromPublic) {
    logDiagnostic('error', 'DEFAULT_NOTIFY_EMAIL and NEXT_PUBLIC_DEFAULT_NOTIFY_EMAIL do not match.', {
      fromPublic,
      fromServer,
    })
  } else {
    logDiagnostic('log', 'DEFAULT_NOTIFY_EMAIL values verified across client and server.')
  }

  return fromPublic
})()

export const SESSION_STORAGE_BASE_KEY = 'sessionId'
export const EMAIL_STORAGE_BASE_KEY = 'defaultEmail'
export const EMAIL_ENABLED_STORAGE_BASE_KEY = 'sendSummaryEmails'
export const ACTIVE_USER_HANDLE_STORAGE_KEY = 'activeUserHandle'
export const KNOWN_USER_HANDLES_STORAGE_KEY = 'knownUserHandles'
export const DEFAULT_NOTIFY_EMAIL = resolvedDefaultNotifyEmail

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

export function buildScopedPath(target: string, handle?: string | null): string {
  const normalized = normalizeHandle(handle)
  const normalizedTarget = target.startsWith('/') ? target : `/${target}`
  if (!normalized) {
    return normalizedTarget
  }
  if (normalizedTarget === '/' || normalizedTarget === '') {
    return `/u/${normalized}`
  }
  return `/u/${normalized}${normalizedTarget}`
}
