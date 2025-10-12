'use client'

import { useCallback, useMemo, useState } from 'react'

type TestKey = 'health' | 'storage' | 'google' | 'openai' | 'smoke' | 'e2e' | 'email'

type TestStatus = 'idle' | 'running' | 'ok' | 'error'

type TestState = {
  status: TestStatus
  message?: string
  data?: unknown
  completedAt?: string
  durationMs?: number
}

type LogLevel = 'info' | 'error'

type LogEntry = {
  id: string
  at: string
  key: TestKey
  level: LogLevel
  message: string
}

type StorageDiagnostics = {
  ok?: boolean
  message?: string
  env?: {
    provider?: string
    store?: string
  }
  flow?: {
    ok?: boolean
    probeId?: string
    startedAt?: string
    steps?: Array<{
      id: string
      label?: string
      ok?: boolean
      optional?: boolean
      skipped?: boolean
      method?: string
      status?: number
      durationMs?: number
      message?: string
      note?: string
      error?: string
      responseSnippet?: string
    }>
  }
  inventory?: {
    totalScanned?: number
    sections?: Array<{
      id: string
      label?: string
      ok?: boolean
      scanned?: number
      hasMore?: boolean
      note?: string
      error?: string
      blobs?: Array<{
        pathname: string
        size?: number
        uploadedAt?: string
        url?: string
        downloadUrl?: string
      }>
    }>
  } | null
}

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

const EASTERN_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})

const EASTERN_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'medium',
  timeStyle: 'short',
})

const BYTE_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
})

function createInitialState(): Record<TestKey, TestState> {
  return TEST_ORDER.reduce<Record<TestKey, TestState>>((acc, key) => {
    acc[key] = { status: 'idle' }
    return acc
  }, {} as Record<TestKey, TestState>)
}

function statusIcon(status: TestStatus): string {
  switch (status) {
    case 'ok':
      return '✅'
    case 'error':
      return '⚠️'
    case 'running':
      return '⏳'
    default:
      return '•'
  }
}

function logPrefix(at: string): string {
  const stamp = EASTERN_CLOCK.format(new Date(at))
  return `[${stamp} ET]`
}

function formatDuration(ms?: number): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatBytes(bytes?: number): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null
  if (bytes < 1024) {
    return `${BYTE_FORMAT.format(bytes)} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${BYTE_FORMAT.format(kb)} KB`
  }
  const mb = kb / 1024
  return `${BYTE_FORMAT.format(mb)} MB`
}

function formatTimestamp(value?: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return null
  return `${EASTERN_DATE_TIME.format(parsed)} ET`
}

function summariseFoxes(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const foxes = (data as any).foxes
  if (!Array.isArray(foxes) || foxes.length === 0) return null
  const warnings = foxes.filter((fox) => fox && typeof fox.level === 'string' && fox.level !== 'info')
  return warnings.length
    ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} flagged`
    : `${foxes.length} info notice${foxes.length === 1 ? '' : 's'}`
}

function extractStorage(data: unknown): StorageDiagnostics | null {
  if (!data || typeof data !== 'object') return null
  return data as StorageDiagnostics
}

export default function DiagnosticsPage() {
  const [results, setResults] = useState<Record<TestKey, TestState>>(createInitialState)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [activeKey, setActiveKey] = useState<TestKey | null>(null)
  const [runningAll, setRunningAll] = useState(false)

  const appendLog = useCallback((key: TestKey, message: string, level: LogLevel = 'info') => {
    setLogs((prev) => {
      const entry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        at: new Date().toISOString(),
        key,
        level,
        message,
      }
      const next = [...prev, entry]
      if (next.length > 250) {
        return next.slice(next.length - 250)
      }
      return next
    })
  }, [])

  const executeTest = useCallback(
    async (key: TestKey) => {
      const config = TEST_CONFIG[key]
      setActiveKey(key)
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          status: 'running',
          message: 'Running…',
        },
      }))
      appendLog(key, `▶ ${config.label}`)
      const started = performance.now()
      try {
        const response = await fetch(config.path, {
          method: config.method,
          cache: 'no-store',
        })
        let data: unknown = null
        let message = response.statusText || `${config.label} completed`

        try {
          data = await response.clone().json()
        } catch {
          try {
            const text = await response.text()
            data = text.length ? text : null
          } catch {
            data = null
          }
        }

        if (data && typeof data === 'object' && 'message' in data && typeof (data as any).message === 'string') {
          message = (data as any).message as string
        } else if (typeof data === 'string' && data.trim().length > 0) {
          message = data.trim()
        } else {
          message = response.ok ? `${config.label} succeeded` : `${config.label} failed (HTTP ${response.status})`
        }

        const finished = performance.now()
        const status: TestStatus = response.ok ? 'ok' : 'error'
        setResults((prev) => ({
          ...prev,
          [key]: {
            status,
            message,
            data,
            durationMs: finished - started,
            completedAt: new Date().toISOString(),
          },
        }))
        appendLog(key, `${response.ok ? '✅' : '❌'} ${message}`, response.ok ? 'info' : 'error')
      } catch (error) {
        const finished = performance.now()
        const message = error instanceof Error ? error.message : 'Unexpected error'
        setResults((prev) => ({
          ...prev,
          [key]: {
            status: 'error',
            message,
            data: null,
            durationMs: finished - started,
            completedAt: new Date().toISOString(),
          },
        }))
        appendLog(key, `❌ ${config.label} — ${message}`, 'error')
      } finally {
        setActiveKey((current) => (current === key ? null : current))
      }
    },
    [appendLog],
  )

  const runAll = useCallback(async () => {
    if (runningAll || activeKey) return
    setRunningAll(true)
    for (const key of TEST_ORDER) {
      await executeTest(key)
    }
    setRunningAll(false)
  }, [activeKey, executeTest, runningAll])

  const clearLogs = useCallback(() => setLogs([]), [])

  const storageData = useMemo(() => extractStorage(results.storage.data), [results.storage.data])

  const logText = useMemo(
    () =>
      logs
        .map((entry) => {
          const label = TEST_CONFIG[entry.key].label
          const prefix = logPrefix(entry.at)
          const indicator = entry.level === 'error' ? '!' : '-' 
          return `${prefix} [${label}] ${indicator} ${entry.message}`
        })
        .join('\n'),
    [logs],
  )

  const overallStatus = useMemo(() => {
    const completed = TEST_ORDER.filter((key) => results[key].status !== 'idle')
    if (completed.length === 0) return 'Tests not yet run.'
    const failures = completed.filter((key) => results[key].status === 'error')
    if (failures.length === 0) return 'All recent diagnostics passed.'
    return `${failures.length} check${failures.length === 1 ? '' : 's'} reporting issues.`
  }, [results])

  return (
    <div className="diagnostics-panel">
      <section className="panel-card diagnostics-card">
        <div className="diagnostics-head">
          <span>Diagnostics dashboard</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn"
              onClick={runAll}
              disabled={runningAll || !!activeKey}
            >
              {runningAll ? 'Running…' : 'Run all checks'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => executeTest('storage')}
              disabled={runningAll || activeKey === 'storage'}
            >
              Run storage only
            </button>
          </div>
        </div>
        <p className="status-hint">{overallStatus}</p>
        <div className="diagnostics-tests">
          {TEST_ORDER.map((key) => {
            const state = results[key]
            const config = TEST_CONFIG[key]
            const foxSummary = summariseFoxes(state.data)
            return (
              <article className="diagnostic-card" key={key}>
                <div className="diagnostic-card-head">
                  <span className="diagnostic-icon">{statusIcon(state.status)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="diagnostic-label">{config.label}</div>
                    <div className="diagnostic-message">{state.message ?? 'Awaiting run.'}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: foxSummary ? 6 : 0 }}>
                      {foxSummary ? (
                        <span className="status-hint">{foxSummary}</span>
                      ) : null}
                      {state.durationMs ? (
                        <span className="status-hint">Duration {formatDuration(state.durationMs)}</span>
                      ) : null}
                      {state.completedAt ? (
                        <span className="status-hint">Finished {logPrefix(state.completedAt)}</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => executeTest(key)}
                    disabled={runningAll || activeKey === key}
                  >
                    Run
                  </button>
                </div>
                {state.data ? (
                  <details style={{ marginTop: 12 }}>
                    <summary className="diagnostics-link">View raw response</summary>
                    <pre style={{ marginTop: 12, maxHeight: 260, overflow: 'auto' }}>
                      {JSON.stringify(state.data, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      {storageData ? (
        <section className="panel-card diagnostics-card">
          <div className="diagnostics-head">
            <span>Storage flow</span>
            <span className="diagnostics-link">{storageData.env?.store ?? 'netlify store'}</span>
          </div>
          <p className="diagnostic-message" style={{ marginTop: 12 }}>
            {storageData.message ?? 'Storage diagnostics completed.'}
          </p>
          {storageData.flow?.steps?.length ? (
            <div className="diagnostics-inventory" style={{ marginTop: 16 }}>
              <h3>Flow steps</h3>
              <ul className="diagnostics-blob-entries">
                {storageData.flow.steps.map((step) => {
                  const status = step.ok ? '✅' : step.skipped ? '⏭️' : '⚠️'
                  const label = step.label ?? step.id
                  const suffix = step.status ? ` · HTTP ${step.status}` : ''
                  const duration = formatDuration(step.durationMs)
                  const details = step.error || step.message || step.responseSnippet || step.note
                  return (
                    <li key={step.id}>
                      <div>
                        <strong>{status} {label}</strong>
                        <span className="status-hint">
                          {suffix}
                          {duration ? ` · ${duration}` : ''}
                        </span>
                      </div>
                      {details ? (
                        <div className="diagnostic-message">{details}</div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {storageData.inventory?.sections?.length ? (
            <div className="diagnostics-inventory" style={{ marginTop: 16 }}>
              <h3>Blob inventory</h3>
              <ul className="diagnostics-blob-list">
                {storageData.inventory.sections.map((section) => (
                  <li key={section.id} className="diagnostic-card">
                    <div className="diagnostic-card-head">
                      <span className="diagnostic-icon">{section.ok ? '📁' : '⚠️'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="diagnostic-label">{section.label ?? section.id}</div>
                        <div className="diagnostic-message">
                          {section.ok
                            ? `${section.scanned ?? 0} item${section.scanned === 1 ? '' : 's'} scanned${
                                section.hasMore ? ' (more available)' : ''
                              }`
                            : section.error ?? 'Listing failed.'}
                        </div>
                        {section.note ? <div className="status-hint">{section.note}</div> : null}
                      </div>
                    </div>
                    {section.blobs?.length ? (
                      <ul className="diagnostics-blob-entries">
                        {section.blobs.map((blob) => (
                          <li key={blob.pathname}>
                            <code>{blob.pathname}</code>
                            <div className="status-hint" style={{ marginTop: 2 }}>
                              {formatBytes(blob.size) ?? 'unknown size'} · {formatTimestamp(blob.uploadedAt) ?? 'unknown time'}
                            </div>
                            {blob.url ? (
                              <a className="diagnostics-link" href={blob.url} target="_blank" rel="noreferrer">
                                View
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="status-hint" style={{ marginTop: 8 }}>
                        No blobs returned for this prefix.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="status-hint">
                Total scanned: {storageData.inventory.totalScanned ?? 0}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel-card diagnostics-card">
        <div className="diagnostics-head">
          <span>Run log</span>
          <button type="button" className="btn" onClick={clearLogs} disabled={!logs.length}>
            Clear log
          </button>
        </div>
        <textarea
          className="diagnostics-log"
          value={logText}
          readOnly
          rows={Math.min(16, Math.max(6, logs.length + 2))}
          placeholder="Diagnostics output will appear here."
          style={{ marginTop: 12 }}
        />
      </section>
    </div>
  )
}
