'use client'

import { useEffect, useMemo, useState } from 'react'

type TestKey = 'health' | 'storage' | 'google' | 'openai' | 'smoke' | 'e2e' | 'email'
type TestResult = { status: 'idle' | 'pending' | 'ok' | 'error'; message?: string }
type FoxRecord = {
  id: string
  theory: number
  level: 'info' | 'warn' | 'error'
  message: string
  details?: Record<string, unknown>
  count: number
  firstTriggeredAt: string
  lastTriggeredAt: string
}

type TranscriptSynopsis = {
  text: string
  turn: number
  at: string
  isEmpty: boolean
  reason?: string
  meta?: {
    started?: boolean
    manualStop?: boolean
    stopReason?: string
  }
  provider?: string | null
}

type ProviderErrorSynopsis = {
  status: number | null
  message: string
  reason?: string
  snippet?: string
  at: string
  resolved?: boolean
  resolvedAt?: string
}

const TRANSCRIPT_STORAGE_KEY = 'diagnostics:lastTranscript'
const PROVIDER_ERROR_STORAGE_KEY = 'diagnostics:lastProviderError'

const TEST_CONFIG: Record<TestKey, { label: string; path: string; method: 'GET' | 'POST' }> = {
  health: { label: 'Health check', path: '/api/health', method: 'GET' },
  storage: { label: 'Storage check', path: '/api/diagnostics/storage', method: 'GET' },
  google: { label: 'Google AI API check', path: '/api/diagnostics/google', method: 'GET' },
  openai: { label: 'OpenAI API check', path: '/api/diagnostics/openai', method: 'GET' },
  smoke: { label: 'Smoke test', path: '/api/diagnostics/smoke', method: 'POST' },
  e2e: { label: 'End-to-end test', path: '/api/diagnostics/e2e', method: 'POST' },
  email: { label: 'Email test', path: '/api/diagnostics/email', method: 'POST' },
}

const TEST_ORDER: TestKey[] = ['health', 'storage', 'google', 'openai', 'smoke', 'e2e', 'email']

function initialResults(): Record<TestKey, TestResult> {
  return {
    health: { status: 'idle' },
    storage: { status: 'idle' },
    google: { status: 'idle' },
    openai: { status: 'idle' },
    smoke: { status: 'idle' },
    e2e: { status: 'idle' },
    email: { status: 'idle' },
  }
}

function formatSummary(key: TestKey, data: any): string {
  if (!data || typeof data !== 'object') return ''

  if (key === 'health') {
    const env = data.env || {}
    const blob = data.blob || {}
    const db = data.db || {}
    const storageLabel = env.hasBlobStore
      ? env.storageStore
        ? `${env.storageProvider || 'netlify'} (${env.storageStore})`
        : env.storageProvider || 'configured'
      : env.storageProvider === 'missing'
      ? 'not configured'
      : env.storageProvider || 'unconfigured'
    const parts = [
      `OpenAI: ${env.hasOpenAI ? 'yes' : 'no'}`,
      `Storage: ${storageLabel}`,
      `Resend: ${env.hasResend ? 'yes' : 'no'}`,
    ]
    if (blob) parts.push(`Storage health: ${blob.ok ? 'ok' : blob.reason || 'error'}`)
    if (db) parts.push(`DB: ${db.ok ? db.mode || 'ok' : db.reason || 'error'}`)
    if (env?.blobDiagnostics) {
      const missing = Array.isArray(env.blobDiagnostics.missing)
        ? env.blobDiagnostics.missing.filter((item: string) => typeof item === 'string')
        : []
      const contextLabel = env.blobDiagnostics.usingContext ? 'context detected' : 'no context payload'
      parts.push(`Blob env: ${missing.length ? `missing ${missing.join(', ')}` : 'complete'} · ${contextLabel}`)
    }
    return parts.join(' · ')
  }

  if (key === 'storage') {
    const diagnostics = data?.env?.diagnostics
    const detailParts: string[] = []
    if (diagnostics) {
      const tokenSource = diagnostics.token?.selected?.key
      const tokenStatus = diagnostics.token?.present
        ? `token present (${tokenSource || 'source unknown'})`
        : 'token missing'
      detailParts.push(tokenStatus)
      const siteSource = diagnostics.siteId?.selected?.key
      const siteStatus = diagnostics.siteId?.present
        ? `site ID present (${siteSource || 'source unknown'})`
        : 'site ID missing'
      detailParts.push(siteStatus)
      const storeStatus = diagnostics.store?.selected?.valuePreview
        ? `store ${diagnostics.store.selected.valuePreview}${diagnostics.store.defaulted ? ' (defaulted)' : ''}`
        : 'store unresolved'
      detailParts.push(storeStatus)
      if (
        diagnostics.optional?.edgeUrl?.present ||
        diagnostics.optional?.apiUrl?.present ||
        diagnostics.optional?.uncachedEdgeUrl?.present
      ) {
        const edge = diagnostics.optional?.edgeUrl?.selected?.valuePreview
        const api = diagnostics.optional?.apiUrl?.selected?.valuePreview
        const uncached = diagnostics.optional?.uncachedEdgeUrl?.selected?.valuePreview
        if (edge) detailParts.push(`edge URL set (${edge})`)
        if (api) detailParts.push(`API URL set (${api})`)
        if (uncached) detailParts.push(`uncached edge URL set (${uncached})`)
      }
      if (Array.isArray(diagnostics.missing) && diagnostics.missing.length) {
        detailParts.push(`missing: ${diagnostics.missing.join(', ')}`)
      }
    }
    const healthDetails = data?.health?.details
    if (healthDetails) {
      if (typeof healthDetails.status === 'number') {
        detailParts.push(`health status ${healthDetails.status}`)
      }
      if (healthDetails.code) {
        detailParts.push(`health code ${healthDetails.code}`)
      }
      if (healthDetails.requestId) {
        detailParts.push(`health request ${healthDetails.requestId}`)
      }
      if (healthDetails.responseBodySnippet) {
        detailParts.push(`health body: ${healthDetails.responseBodySnippet}`)
      }
    }
    if (typeof data?.message === 'string') {
      return detailParts.length ? `${data.message} · ${detailParts.join(' · ')}` : data.message
    }
    if (data?.env?.provider === 'netlify' && data?.ok) {
      return detailParts.length
        ? `Netlify blob storage ready · ${detailParts.join(' · ')}`
        : 'Netlify blob storage ready.'
    }
    if (data?.env?.provider === 'missing') {
      return detailParts.length
        ? `Persistent storage not configured · ${detailParts.join(' · ')}`
        : 'Persistent storage not configured.'
    }
    if (data?.health?.reason) return `Error: ${data.health.reason}`
    return data?.ok ? 'Storage check passed' : 'Storage check failed'
  }

  if (key === 'google') {
    if (data.ok) {
      const model = data.model || {}
      const replyText = typeof data.reply === 'string' ? data.reply.trim() : ''
      const replySnippet = replyText.length > 60 ? `${replyText.slice(0, 57)}…` : replyText
      const reply = replySnippet ? ` · Reply: ${replySnippet}` : ''
      return `Model: ${model.name || model.id || 'unknown'}${reply}`
    }
    if (data.error) return `Error: ${data.error}`
    if (data.status && data.message) return `HTTP ${data.status}: ${data.message}`
  }

  if (key === 'openai') {
    if (data.ok) {
      const modelId = data.model?.id || data.model || 'unknown model'
      const replyText = typeof data.reply === 'string' ? data.reply.trim() : ''
      const replySnippet = replyText.length > 60 ? `${replyText.slice(0, 57)}…` : replyText
      const reply = replySnippet ? ` · Reply: ${replySnippet}` : ''
      return `Model: ${modelId}${reply}`
    }
    if (data.error) return `Error: ${data.error}`
    if (data.status && data.message) return `HTTP ${data.status}: ${data.message}`
  }

  if (key === 'email') {
    const status = data.status || {}
    if (status.ok) return `Email sent via ${status.provider || 'configured provider'}`
    if (status.skipped) return 'Email skipped (no provider configured)'
  }

  if (key === 'smoke') {
    if (data.ok) return 'Session created and finalized'
    const detailParts: string[] = []
    if (data.stage) detailParts.push(`stage ${data.stage}`)
    if (data.cause) detailParts.push(`cause: ${data.cause}`)
    const blobDetails = data.details || data.blobDetails
    if (blobDetails) {
      if (typeof blobDetails.status === 'number') detailParts.push(`status ${blobDetails.status}`)
      if (blobDetails.code) detailParts.push(`code ${blobDetails.code}`)
      if (blobDetails.requestId) detailParts.push(`request ${blobDetails.requestId}`)
      if (blobDetails.store) detailParts.push(`store ${blobDetails.store}`)
      if (blobDetails.target) detailParts.push(`target ${blobDetails.target}`)
    }
    return detailParts.length
      ? `${data.error || 'Smoke test failed'} · ${detailParts.join(' · ')}`
      : data.error || 'Smoke test failed'
  }
  if (key === 'e2e') {
    if (data.ok) return 'Session completed end-to-end'
    const detailParts: string[] = []
    if (data.stage) detailParts.push(`stage ${data.stage}`)
    if (data.cause) detailParts.push(`cause: ${data.cause}`)
    const blobDetails = data.details || data.blobDetails
    if (blobDetails) {
      if (typeof blobDetails.status === 'number') detailParts.push(`status ${blobDetails.status}`)
      if (blobDetails.code) detailParts.push(`code ${blobDetails.code}`)
      if (blobDetails.requestId) detailParts.push(`request ${blobDetails.requestId}`)
      if (blobDetails.store) detailParts.push(`store ${blobDetails.store}`)
      if (blobDetails.target) detailParts.push(`target ${blobDetails.target}`)
    }
    return detailParts.length
      ? `${data.error || 'E2E test failed'} · ${detailParts.join(' · ')}`
      : data.error || 'E2E test failed'
  }

  if (data.error) return `Error: ${data.error}`
  return data.ok ? 'Passed' : 'Failed'
}

export default function DiagnosticsPage() {
  const [latestTranscript, setLatestTranscript] = useState<TranscriptSynopsis | null>(null)
  const [latestProviderError, setLatestProviderError] = useState<ProviderErrorSynopsis | null>(null)
  const [log, setLog] = useState<string>('Ready. Run diagnostics to gather fresh results.')
  const [results, setResults] = useState<Record<TestKey, TestResult>>(() => initialResults())
  const [isRunning, setIsRunning] = useState(false)
  const [foxes, setFoxes] = useState<FoxRecord[]>([])
  const [storageAlert, setStorageAlert] = useState<
    | {
        message: string
        missing?: string[]
        healthReason?: string
        source: 'health' | 'storage' | 'request'
      }
    | null
  >(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = () => {
      try {
        const raw = window.localStorage.getItem(TRANSCRIPT_STORAGE_KEY)
        if (!raw) {
          setLatestTranscript(null)
        } else {
          const parsed = JSON.parse(raw)
          if (!parsed || typeof parsed !== 'object') {
            setLatestTranscript(null)
          } else {
            const payload: TranscriptSynopsis = {
              text: typeof (parsed as any).text === 'string' ? (parsed as any).text : '',
              turn: typeof (parsed as any).turn === 'number' ? (parsed as any).turn : 0,
              at: typeof (parsed as any).at === 'string' ? (parsed as any).at : '',
              isEmpty: Boolean((parsed as any).isEmpty),
              reason: typeof (parsed as any).reason === 'string' ? (parsed as any).reason : undefined,
              meta:
                (parsed as any).meta && typeof (parsed as any).meta === 'object'
                  ? {
                      started:
                        typeof (parsed as any).meta.started === 'boolean'
                          ? (parsed as any).meta.started
                          : undefined,
                      manualStop:
                        typeof (parsed as any).meta.manualStop === 'boolean'
                          ? (parsed as any).meta.manualStop
                          : undefined,
                      stopReason:
                        typeof (parsed as any).meta.stopReason === 'string'
                          ? (parsed as any).meta.stopReason
                          : undefined,
                    }
                  : undefined,
              provider:
                typeof (parsed as any).provider === 'string'
                  ? (parsed as any).provider
                  : (parsed as any).provider === null
                  ? null
                  : undefined,
            }
            setLatestTranscript(payload)
          }
        }
      } catch {
        setLatestTranscript(null)
      }

      try {
        const rawError = window.localStorage.getItem(PROVIDER_ERROR_STORAGE_KEY)
        if (!rawError) {
          setLatestProviderError(null)
        } else {
          const parsedError = JSON.parse(rawError)
          if (!parsedError || typeof parsedError !== 'object') {
            setLatestProviderError(null)
          } else {
            const rawStatus =
              typeof (parsedError as any).status === 'number'
                ? (parsedError as any).status
                : typeof (parsedError as any).status === 'string'
                ? Number.parseInt((parsedError as any).status, 10)
                : null
            const normalizedStatus =
              typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : null
            const snapshot: ProviderErrorSynopsis = {
              status: normalizedStatus,
              message: typeof (parsedError as any).message === 'string' ? (parsedError as any).message : 'Unknown error',
              reason: typeof (parsedError as any).reason === 'string' ? (parsedError as any).reason : undefined,
              snippet: typeof (parsedError as any).snippet === 'string' ? (parsedError as any).snippet : undefined,
              at: typeof (parsedError as any).at === 'string' ? (parsedError as any).at : '',
              resolved: (parsedError as any).resolved === true,
              resolvedAt:
                typeof (parsedError as any).resolvedAt === 'string' ? (parsedError as any).resolvedAt : undefined,
            }
            setLatestProviderError(snapshot)
          }
        }
      } catch {
        setLatestProviderError(null)
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === TRANSCRIPT_STORAGE_KEY ||
        event.key === PROVIDER_ERROR_STORAGE_KEY
      ) {
        read()
      }
    }
    const handleFocus = () => {
      if (typeof document !== 'undefined') {
        if (document.visibilityState && document.visibilityState !== 'visible') return
      }
      read()
    }
    read()
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', handleFocus)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleFocus)
    }
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', handleFocus)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleFocus)
      }
    }
  }, [])

  const formatFlag = (value: boolean | undefined) =>
    value === true ? 'yes' : value === false ? 'no' : 'unknown'

  const append = (line: string) =>
    setLog((l) => (l && l.length > 0 ? l + '\n' + line : line))

  const statusIcon = useMemo(
    () => ({ idle: '•', pending: '…', ok: '✅', error: '❌' } as const),
    []
  )

  const updateResult = (key: TestKey, patch: Partial<TestResult>) => {
    setResults(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function runDiagnostics() {
    if (isRunning) return
    setIsRunning(true)
    setLog('Running diagnostics...')
    setResults(initialResults())
    setFoxes([])
    setStorageAlert(null)

    let transcriptSnapshot: TranscriptSynopsis | null = null
    let providerSnapshot: ProviderErrorSynopsis | null = null
    if (typeof window !== 'undefined') {
      try {
        const rawTranscript = window.localStorage.getItem(TRANSCRIPT_STORAGE_KEY)
        if (rawTranscript) {
          const parsedTranscript = JSON.parse(rawTranscript)
          if (parsedTranscript && typeof parsedTranscript === 'object') {
            transcriptSnapshot = {
              text: typeof (parsedTranscript as any).text === 'string' ? (parsedTranscript as any).text : '',
              turn: typeof (parsedTranscript as any).turn === 'number' ? (parsedTranscript as any).turn : 0,
              at: typeof (parsedTranscript as any).at === 'string' ? (parsedTranscript as any).at : '',
              isEmpty: Boolean((parsedTranscript as any).isEmpty),
              reason:
                typeof (parsedTranscript as any).reason === 'string'
                  ? (parsedTranscript as any).reason
                  : undefined,
              meta:
                (parsedTranscript as any).meta && typeof (parsedTranscript as any).meta === 'object'
                  ? {
                      started:
                        typeof (parsedTranscript as any).meta.started === 'boolean'
                          ? (parsedTranscript as any).meta.started
                          : undefined,
                      manualStop:
                        typeof (parsedTranscript as any).meta.manualStop === 'boolean'
                          ? (parsedTranscript as any).meta.manualStop
                          : undefined,
                      stopReason:
                        typeof (parsedTranscript as any).meta.stopReason === 'string'
                          ? (parsedTranscript as any).meta.stopReason
                          : undefined,
                    }
                  : undefined,
            }
          }
        }
      } catch {}

      try {
        const rawError = window.localStorage.getItem(PROVIDER_ERROR_STORAGE_KEY)
        if (rawError) {
          const parsed = JSON.parse(rawError)
          if (parsed && typeof parsed === 'object') {
            const rawStatus =
              typeof (parsed as any).status === 'number'
                ? (parsed as any).status
                : typeof (parsed as any).status === 'string'
                ? Number.parseInt((parsed as any).status, 10)
                : null
            const normalizedStatus =
              typeof rawStatus === 'number' && Number.isFinite(rawStatus) ? rawStatus : null
            providerSnapshot = {
              status: normalizedStatus,
              message: typeof (parsed as any).message === 'string' ? (parsed as any).message : 'Unknown error',
              reason: typeof (parsed as any).reason === 'string' ? (parsed as any).reason : undefined,
              snippet: typeof (parsed as any).snippet === 'string' ? (parsed as any).snippet : undefined,
              at: typeof (parsed as any).at === 'string' ? (parsed as any).at : '',
              resolved: (parsed as any).resolved === true,
              resolvedAt:
                typeof (parsed as any).resolvedAt === 'string' ? (parsed as any).resolvedAt : undefined,
            }
          }
        }
      } catch {}
    }

    setLatestTranscript(transcriptSnapshot)
    if (providerSnapshot) {
      setLatestProviderError(providerSnapshot)
    } else {
      setLatestProviderError(null)
    }

    if (transcriptSnapshot) {
      const capturedAt =
        transcriptSnapshot.at && !Number.isNaN(Date.parse(transcriptSnapshot.at))
          ? new Date(transcriptSnapshot.at).toLocaleString()
          : 'time unknown'
      if (transcriptSnapshot.isEmpty) {
        const reasonLabel = transcriptSnapshot.reason
          ? ` (${String(transcriptSnapshot.reason).replace(/_/g, ' ')})`
          : ''
        append(`[transcript] Turn ${transcriptSnapshot.turn || '–'} at ${capturedAt}: no transcript${reasonLabel}.`)
      } else {
        append(
          `[transcript] Turn ${transcriptSnapshot.turn || '–'} at ${capturedAt}: "${transcriptSnapshot.text}"`,
        )
      }
      if (transcriptSnapshot.meta) {
        append(
          `[transcript] Meta → started=${formatFlag(transcriptSnapshot.meta.started)} · manual_stop=${formatFlag(
            transcriptSnapshot.meta.manualStop,
          )} · stop_reason=${transcriptSnapshot.meta.stopReason || 'unknown'}`,
        )
      }
    } else {
      append('[transcript] No transcript data captured yet.')
    }

    if (providerSnapshot) {
      const capturedAt = providerSnapshot.at && !Number.isNaN(Date.parse(providerSnapshot.at))
        ? new Date(providerSnapshot.at).toLocaleString()
        : 'time unknown'
      append(
        `[provider-error] ${
          providerSnapshot.status ? `HTTP ${providerSnapshot.status}` : 'Request failed'
        } at ${capturedAt} (${providerSnapshot.reason || 'reason unknown'})`,
      )
      if (providerSnapshot.resolved) {
        const resolvedAt =
          providerSnapshot.resolvedAt && !Number.isNaN(Date.parse(providerSnapshot.resolvedAt))
            ? new Date(providerSnapshot.resolvedAt).toLocaleString()
            : 'time unknown'
        append(`[provider-error] Resolved at ${resolvedAt}`)
      }
      if (providerSnapshot.snippet) {
        append(`[provider-error] Snippet: ${providerSnapshot.snippet}`)
      }
    } else {
      append('[provider-error] No provider errors recorded yet.')
    }

    for (const key of TEST_ORDER) {
      const { path, method } = TEST_CONFIG[key]
      updateResult(key, { status: 'pending', message: undefined })
      append(`→ ${path}`)

      try {
        const res = await fetch(path, {
          method,
          headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        })
        const rawText = await res.text()
        let parsed: any = null
        try {
          parsed = JSON.parse(rawText)
        } catch (err) {
          parsed = null
        }

        if (parsed) {
          append(JSON.stringify(parsed, null, 2))
          const ok = typeof parsed.ok === 'boolean' ? parsed.ok : res.ok
          const message = formatSummary(key, parsed)
          updateResult(key, { status: ok ? 'ok' : 'error', message })
          if (key === 'health') {
            const blobMode = parsed?.blob?.mode
            if (blobMode === 'missing') {
              const missing = Array.isArray(parsed?.env?.blobDiagnostics?.missing)
                ? parsed.env.blobDiagnostics.missing.filter(
                    (item: unknown): item is string => typeof item === 'string',
                  )
                : undefined
              const reason =
                typeof parsed?.blob?.reason === 'string' && parsed.blob.reason.length
                  ? parsed.blob.reason
                  : 'Netlify blob storage is not configured.'
              setStorageAlert(prev => {
                if (prev && prev.source === 'storage') return prev
                return { message: reason, missing, healthReason: reason, source: 'health' }
              })
            }
          }
          if (key === 'storage') {
            if (!ok) {
              const missing = Array.isArray(parsed?.env?.diagnostics?.missing)
                ? parsed.env.diagnostics.missing.filter(
                    (item: unknown): item is string => typeof item === 'string',
                  )
                : undefined
              const reason =
                typeof parsed?.health?.reason === 'string' && parsed.health.reason.length
                  ? parsed.health.reason
                  : undefined
              const messageText =
                typeof parsed?.message === 'string' && parsed.message.length
                  ? parsed.message
                  : 'Persistent storage not configured.'
              setStorageAlert({
                message: messageText,
                missing,
                healthReason: reason,
                source: 'storage',
              })
            }
          }
        } else {
          append(rawText || '(no response body)')
          updateResult(key, {
            status: res.ok ? 'ok' : 'error',
            message: res.ok ? 'Received response' : `HTTP ${res.status}`,
          })
        }
      } catch (e: any) {
        const errorMessage = e?.message || 'Request failed'
        append(`Request failed: ${errorMessage}`)
        updateResult(key, { status: 'error', message: errorMessage })
        if (key === 'storage') {
          setStorageAlert({ message: `Storage diagnostics failed: ${errorMessage}`, source: 'request' })
        }
      }
    }

    try {
      const foxRes = await fetch('/api/diagnostics/foxes')
      if (foxRes.ok) {
        const data = await foxRes.json()
        if (data && Array.isArray(data.foxes)) {
          setFoxes(data.foxes as FoxRecord[])
          if (data.foxes.length) {
            append(`Foxes flagged: ${data.foxes.length}`)
            append(JSON.stringify(data.foxes, null, 2))
          } else {
            append('Foxes flagged: 0')
          }
        }
      }
    } catch (err) {
      append('Failed to load fox diagnostics.')
    }

    append('Diagnostics complete.')
    setIsRunning(false)
  }

  const transcriptTurnLabel =
    latestTranscript && typeof latestTranscript.turn === 'number' && latestTranscript.turn > 0
      ? latestTranscript.turn
      : '–'
  const transcriptTimestampLabel =
    latestTranscript && typeof latestTranscript.at === 'string' && latestTranscript.at.length
      ? Number.isNaN(Date.parse(latestTranscript.at))
        ? 'time unknown'
        : new Date(latestTranscript.at).toLocaleString()
      : 'time unknown'
  const transcriptReasonLabel = latestTranscript?.reason
    ? ` (${String(latestTranscript.reason).replace(/_/g, ' ')})`
    : ''
  const transcriptProviderLabel = latestTranscript?.provider
    ? latestTranscript.provider
    : 'provider unknown'

  const storageSourceLabel = storageAlert
    ? storageAlert.source === 'health'
      ? 'health check'
      : storageAlert.source === 'storage'
      ? 'storage diagnostics'
      : storageAlert.source === 'request'
      ? 'network request'
      : storageAlert.source
    : undefined

  return (
    <main>
      <div className="panel-card diagnostics-panel">
        <h2 className="page-heading">Diagnostics</h2>
        <button onClick={runDiagnostics} disabled={isRunning} className="btn-secondary btn-large">
          {isRunning ? 'Running…' : 'Run full diagnostics'}
        </button>

        {storageAlert && (
          <div className="diagnostic-card diagnostic-card-critical">
            <div className="diagnostic-card-head">
              <span className="diagnostic-icon" aria-hidden="true">
                🚨
              </span>
              <span className="diagnostic-label">Persistent storage unavailable</span>
            </div>
            <div className="diagnostic-message">{storageAlert.message}</div>
            {storageAlert.missing && storageAlert.missing.length > 0 && (
              <ul className="diagnostic-alert-list">
                {storageAlert.missing.map((item) => (
                  <li key={item}>Missing: {item}</li>
                ))}
              </ul>
            )}
            {storageAlert.healthReason && storageAlert.healthReason !== storageAlert.message && (
              <div className="diagnostic-meta">Health check: {storageAlert.healthReason}</div>
            )}
            <div className="diagnostic-meta">Source: {storageSourceLabel || storageAlert.source}</div>
          </div>
        )}

        <div className="diagnostics-transcript">
          <h3>Latest transcript heard</h3>
          {latestTranscript ? (
            <div className="diagnostic-card">
              <div className="diagnostic-card-head">
                <span className="diagnostic-label">
                  Turn {transcriptTurnLabel} · {transcriptTimestampLabel} · {transcriptProviderLabel}
                </span>
              </div>
              <div className="diagnostic-message">
                {latestTranscript.isEmpty
                  ? `No transcript captured${transcriptReasonLabel}.`
                  : `“${latestTranscript.text}”`}
              </div>
              {latestTranscript.meta && (
                <div className="diagnostic-meta">
                  Started: {formatFlag(latestTranscript.meta.started)} · Manual stop:{' '}
                  {formatFlag(latestTranscript.meta.manualStop)} · Stop reason:{' '}
                  {latestTranscript.meta.stopReason || 'unknown'}
                </div>
              )}
            </div>
          ) : (
            <p className="status-note">No recent transcript data captured yet.</p>
          )}
        </div>

        <div className="diagnostics-provider-error">
          <h3>Latest provider error</h3>
          {latestProviderError ? (
            <div className="diagnostic-card">
              <div className="diagnostic-card-head">
                <span className="diagnostic-label">
                  {latestProviderError.status ? `HTTP ${latestProviderError.status}` : 'Request failed'} ·{' '}
                  {Number.isNaN(Date.parse(latestProviderError.at))
                    ? 'time unknown'
                    : new Date(latestProviderError.at).toLocaleString()}
                </span>
              </div>
              <div className="diagnostic-message">{latestProviderError.message}</div>
              <div className="diagnostic-meta">
                Reason: {latestProviderError.reason || 'unspecified'} · Status:{' '}
                {latestProviderError.resolved ? 'resolved' : 'active'}
                {latestProviderError.resolved && latestProviderError.resolvedAt
                  ? ` at ${new Date(latestProviderError.resolvedAt).toLocaleString()}`
                  : ''}
              </div>
              {latestProviderError.snippet && (
                <pre className="diagnostic-snippet">{latestProviderError.snippet}</pre>
              )}
            </div>
          ) : (
            <p className="status-note">No provider errors have been recorded yet.</p>
          )}
        </div>

        <div className="diagnostics-tests">
          {TEST_ORDER.map((key) => {
            const result = results[key]
            return (
              <div key={key} className="diagnostic-card">
                <div className="diagnostic-card-head">
                  <span className="diagnostic-icon" aria-hidden="true">
                    {statusIcon[result.status]}
                  </span>
                  <span className="diagnostic-label">{TEST_CONFIG[key].label}</span>
                </div>
                {result.message && <div className="diagnostic-message">{result.message}</div>}
              </div>
            )
          })}
        </div>

        <textarea value={log} readOnly rows={12} className="diagnostics-log" />

        <div className="diagnostics-foxes">
          <h3>Tracked foxes</h3>
          {foxes.length === 0 ? (
            <p className="status-note">No foxes have been triggered yet.</p>
          ) : (
            <ul className="diagnostics-fox-list">
              {foxes.map((fox) => (
                <li key={fox.id} className="diagnostic-card">
                  <div className="fox-head">
                    <span className="fox-title">Theory {fox.theory} – {fox.message}</span>
                    <span className="fox-level">{fox.level}</span>
                  </div>
                  <div className="fox-meta">
                    Count: {fox.count} · Last: {new Date(fox.lastTriggeredAt).toLocaleString()}
                  </div>
                  {fox.details && (
                    <pre className="fox-details">{JSON.stringify(fox.details, null, 2)}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
