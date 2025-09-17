'use client'

import { useMemo, useState } from 'react'

type TestKey = 'health' | 'smoke' | 'e2e' | 'email'
type TestResult = { status: 'idle' | 'pending' | 'ok' | 'error'; message?: string }

const TEST_CONFIG: Record<TestKey, { label: string; path: string; method: 'GET' | 'POST' }> = {
  health: { label: 'Health check', path: '/api/health', method: 'GET' },
  smoke: { label: 'Smoke test', path: '/diag-api/smoke', method: 'POST' },
  e2e: { label: 'End-to-end test', path: '/diag-api/e2e', method: 'POST' },
  email: { label: 'Email test', path: '/diag-api/email', method: 'POST' },
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

    append('Diagnostics complete.')
    setIsRunning(false)
  }

  return (
    <main>
      <h2 className="text-lg font-semibold mb-3">Diagnostics</h2>
      <button
        onClick={runDiagnostics}
        disabled={isRunning}
        className="bg-white/10 px-4 py-2 rounded-2xl disabled:opacity-50"
      >
        {isRunning ? 'Running…' : 'Run full diagnostics'}
      </button>

      <div className="mt-4 space-y-3">
        {TEST_ORDER.map(key => {
          const result = results[key]
          return (
            <div key={key} className="bg-white/5 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xl leading-none">{statusIcon[result.status]}</span>
                <span className="font-medium">{TEST_CONFIG[key].label}</span>
              </div>
              {result.message && (
                <div className="mt-1 text-sm opacity-80 whitespace-pre-wrap">{result.message}</div>
              )}
            </div>
          )
        })}
      </div>

      <textarea
        value={log}
        readOnly
        className="mt-4 w-full h-96 bg-black/30 p-2 rounded"
      />
    </main>
  )
}
