'use client'

import { useEffect, useMemo, useState } from 'react'

type TestKey = 'health' | 'smoke' | 'e2e' | 'email'
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
}

const TRANSCRIPT_STORAGE_KEY = 'diagnostics:lastTranscript'

const TEST_CONFIG: Record<TestKey, { label: string; path: string; method: 'GET' | 'POST' }> = {
  health: { label: 'Health check', path: '/api/health', method: 'GET' },
  smoke: { label: 'Smoke test', path: '/api/diagnostics/smoke', method: 'POST' },
  e2e: { label: 'End-to-end test', path: '/api/diagnostics/e2e', method: 'POST' },
  email: { label: 'Email test', path: '/api/diagnostics/email', method: 'POST' },
}

const TEST_ORDER: TestKey[] = ['health', 'smoke', 'e2e', 'email']

function initialResults(): Record<TestKey, TestResult> {
  return {
    health: { status: 'idle' },
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
    const parts = [
      `OpenAI: ${env.hasOpenAI ? 'yes' : 'no'}`,
      `Blob token: ${env.hasBlobToken ? 'yes' : 'no'}`,
      `Resend: ${env.hasResend ? 'yes' : 'no'}`,
    ]
    if (blob) parts.push(`Blob check: ${blob.ok ? 'ok' : blob.reason || 'error'}`)
    if (db) parts.push(`DB: ${db.ok ? db.mode || 'ok' : db.reason || 'error'}`)
    return parts.join(' · ')
  }

  if (key === 'email') {
    const status = data.status || {}
    if (status.ok) return `Email sent via ${status.provider || 'configured provider'}`
    if (status.skipped) return 'Email skipped (no provider configured)'
  }

  if (key === 'smoke' && data.ok) return 'Session created and finalized'
  if (key === 'e2e' && data.ok) return 'Session completed end-to-end'

  if (data.error) return `Error: ${data.error}`
  return data.ok ? 'Passed' : 'Failed'
}

export default function DiagnosticsPage() {
  const [latestTranscript, setLatestTranscript] = useState<TranscriptSynopsis | null>(null)
  const [log, setLog] = useState<string>('Ready. Run diagnostics to gather fresh results.')
  const [results, setResults] = useState<Record<TestKey, TestResult>>(() => initialResults())
  const [isRunning, setIsRunning] = useState(false)
  const [foxes, setFoxes] = useState<FoxRecord[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = () => {
      try {
        const raw = window.localStorage.getItem(TRANSCRIPT_STORAGE_KEY)
        if (!raw) {
          setLatestTranscript(null)
          return
        }
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') {
          setLatestTranscript(null)
          return
        }
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
        }
        setLatestTranscript(payload)
      } catch {
        setLatestTranscript(null)
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === TRANSCRIPT_STORAGE_KEY) {
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
    setLog(l => (l && l.length > 0 ? l + '\n' + line : line))

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

  return (
    <main>
      <div className="panel-card diagnostics-panel">
        <h2 className="page-heading">Diagnostics</h2>
        <button onClick={runDiagnostics} disabled={isRunning} className="btn-secondary btn-large">
          {isRunning ? 'Running…' : 'Run full diagnostics'}
        </button>

        <div className="diagnostics-transcript">
          <h3>Latest transcript heard</h3>
          {latestTranscript ? (
            <div className="diagnostic-card">
              <div className="diagnostic-card-head">
                <span className="diagnostic-label">Turn {transcriptTurnLabel} · {transcriptTimestampLabel}</span>
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
