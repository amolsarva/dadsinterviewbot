'use client'
import { useInterviewMachine } from '@/lib/machine'
import { useEffect } from 'react'

export default function Home() {
  const m = useInterviewMachine()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        m.primary()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [m])

  return (
    <main className="mt-8">
      <div className="flex flex-col items-center gap-6">
        <div className="w-52 h-52 rounded-full flex items-center justify-center"
          style={{boxShadow: m.state === 'recording' ? '0 0 0 12px rgba(234,88,12,0.25)' : '0 0 0 0 rgba(0,0,0,0)', transition:'box-shadow 300ms'}}>
          <button
            onClick={m.primary}
            disabled={m.disabled}
            className="text-lg bg-white/10 hover:bg-white/20 disabled:opacity-50"
          >
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
        <div className="w-full max-w-xl">
          <textarea value={m.debugLog.join('\n')} readOnly className="w-full h-48 bg-black/30 p-2 rounded" />
        </div>
      </div>
    </main>
  )
}
