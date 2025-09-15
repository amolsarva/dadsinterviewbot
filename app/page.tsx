'use client'
import { useInterviewMachine } from '@/lib/machine'
import { useEffect, useState } from 'react'

export default function Home() {
  const m = useInterviewMachine()
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Spacebar triggers primary ONLY when not typing and not disabled
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = (target?.tagName || '').toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea' || (target?.isContentEditable ?? false)
      if (isTyping) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (!m.disabled) m.primary()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [m])

  // Create a session when recording starts
  useEffect(() => {
    if (m.state === 'recording' && !sessionId) {
      fetch('/api/session/start', { method: 'POST' })
        .then(r => r.json())
        .then(d => setSessionId(d?.id))
        .catch(() => m.pushLog('Failed to start session'))
    }
  }, [m.state, sessionId])

  return (
    <main className="mt-8">
      <div className="flex flex-col items-center gap-6">
        <div className="w-52 h-52 rounded-full flex items-center justify-center"
          style={{boxShadow: m.state === 'recording' ? '0 0 0 12px rgba(234,88,12,0.25)' : '0 0 0 0 rgba(0,0,0,0)', transition:'box-shadow 300ms'}}>
          <button onClick={m.primary} disabled={m.disabled} className="text-lg bg-white/10 hover:bg-white/20 disabled:opacity-50">
            {m.label}
          </button>
        </div>
        <div className="text-sm opacity-80">
          {m.state === 'idle' && 'Ready'}
          {m.state === 'recording' && 'Recording…'}
          {m.state === 'thinking' && 'Thinking…'}
          {m.state === 'playing' && 'Playing reply…'}
          {m.state === 'readyToContinue' && 'Ready to continue'}
          {m.state === 'doneSuccess' && 'Saved & emailed (if configured)'}
        </div>

        <div className="flex gap-3">
          <button
            onClick={async () => {
              if (!sessionId) return
              m.setDisabled(true)
              try {
                await fetch(`/api/session/${sessionId}/finalize`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ clientDurationMs: m.elapsedMs ?? 0 }),
                })
                m.toDone()
              } finally {
                m.setDisabled(false)
              }
            }}
            className="text-sm bg-white/10 px-3 py-1 rounded-2xl"
          >
            Finish Session
          </button>
        </div>

        <div className="w-full max-w-xl">
          <textarea value={m.debugLog.join('\n')} readOnly className="w-full h-48 bg-black/30 p-2 rounded" />
        </div>
      </div>
    </main>
  )
}
