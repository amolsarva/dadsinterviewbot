export const GOOGLE_DEFAULT_MODEL = 'gemini-2.5-flash-lite'

export function normalizeGoogleModel(raw?: string | null): string {
  const fallback = GOOGLE_DEFAULT_MODEL
  if (typeof raw !== 'string') return fallback
  let value = raw.trim()
  if (!value) return fallback

  value = value.replace(/^models\//i, '')
  value = value.replace(/:(generateContent|streamGenerateContent)$/i, '')
  value = value.replace(/\?.*$/, '')

  const lower = value.toLowerCase()
  if (lower.startsWith('gemini-1.5')) {
    return fallback
  }
  if (lower.startsWith('gemini-2.5-') && lower.endsWith('-latest')) {
    value = value.slice(0, -'-latest'.length)
  }

  return value || fallback
}

export function resolveGoogleModel(raw?: string | null): string {
  return normalizeGoogleModel(raw)
}
