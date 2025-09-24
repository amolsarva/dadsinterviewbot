'use client'

import { useMemo, useState } from 'react'

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
  const [log, setLog] = useState<string>('Ready. Run diagnostics to gather fresh results.')
  const [results, setResults] = useState<Record<TestKey, TestResult>>(() => initialResults())
  const [isRunning, setIsRunning] = useState(false)
  const [foxes, setFoxes] = useState<FoxRecord[]>([])

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

  return (
    <main className="flex flex-col gap-6 text-[rgba(255,247,237,0.9)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Diagnostics</h2>
          <p className="text-xs text-[rgba(255,247,237,0.7)]">Check on our services and keep the interview studio running smoothly.</p>
        </div>
        <button
          onClick={runDiagnostics}
          disabled={isRunning}
          className="rounded-full border border-[rgba(249,115,22,0.45)] bg-gradient-to-r from-[#f59e0b] via-[#f97316] to-[#d946ef] px-5 py-2 text-sm font-semibold text-white shadow-[0_15px_45px_rgba(249,115,22,0.35)] transition hover:from-[#f97316] hover:via-[#ec4899] hover:to-[#8b5cf6] disabled:cursor-not-allowed disabled:border-[rgba(255,214,150,0.2)] disabled:bg-[rgba(249,115,22,0.12)] disabled:text-[rgba(255,247,237,0.5)]"
        >
          {isRunning ? 'Running…' : 'Run full diagnostics'}
        </button>
      </div>

      <div className="space-y-3">
        {TEST_ORDER.map((key) => {
          const result = results[key]
          return (
            <div
              key={key}
              className="rounded-3xl border border-[rgba(156,163,255,0.3)] bg-[rgba(24,9,42,0.7)] px-4 py-4 shadow-[0_15px_50px_rgba(91,33,182,0.25)]"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl leading-none text-[rgba(255,247,237,0.9)]">{statusIcon[result.status]}</span>
                <span className="text-sm font-semibold text-white">{TEST_CONFIG[key].label}</span>
              </div>
              {result.message && (
                <div className="mt-2 text-sm text-[rgba(255,247,237,0.78)] whitespace-pre-wrap">{result.message}</div>
              )}
            </div>
          )
        })}
      </div>

      <label className="mt-2 text-xs uppercase tracking-[0.4em] text-[rgba(255,247,237,0.6)]">Log output</label>
      <textarea
        value={log}
        readOnly
        className="h-80 w-full rounded-3xl border border-[rgba(156,163,255,0.35)] bg-[rgba(10,4,24,0.8)] p-4 text-sm leading-relaxed text-[rgba(255,247,237,0.82)] shadow-[0_15px_60px_rgba(91,33,182,0.3)]"
      />

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white">Tracked foxes</h3>
        {foxes.length === 0 ? (
          <p className="text-sm text-[rgba(255,247,237,0.7)]">No foxes have been triggered yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {foxes.map((fox) => (
              <li
                key={fox.id}
                className="rounded-3xl border border-[rgba(249,115,22,0.35)] bg-[rgba(33,12,53,0.75)] px-4 py-3 shadow-[0_15px_50px_rgba(249,115,22,0.25)]"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium text-white">Theory {fox.theory} – {fox.message}</span>
                  <span className="text-xs uppercase tracking-wide text-[rgba(255,247,237,0.65)]">{fox.level}</span>
                </div>
                <div className="mt-1 text-xs text-[rgba(255,247,237,0.65)]">
                  Count: {fox.count} · Last: {new Date(fox.lastTriggeredAt).toLocaleString()}
                </div>
                {fox.details && (
                  <pre className="mt-2 rounded-2xl bg-[rgba(10,4,24,0.85)] p-3 text-xs text-[rgba(255,247,237,0.8)] whitespace-pre-wrap">
                    {JSON.stringify(fox.details, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
