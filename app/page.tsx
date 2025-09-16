"use client"
import { useInterviewMachine } from '@/lib/machine'
import { speak } from '@/lib/tts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from '@/lib/audio-bridge'

const OPENING = `Hello and welcome to Dad’s Interview Bot. I’m your biographer companion. We’ll have gentle, short conversations to help you recall stories. When a question finishes, just answer in your own words, and when you pause I’ll ask a thoughtful follow-up. Take your time. Let’s begin.`

export default function Home() {
  const m = useInterviewMachine()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turn, setTurn] = useState<number>(0)
  const runningRef = useRef(false)
  const inTurnRef = useRef(false)

  // Restore or create a persistent session id for blob-based flow
  useEffect(() => {
    try {
      const existing = sessionStorage.getItem('sessionId')
      if (existing) {
        setSessionId(existing)
        m.pushLog('Session started: ' + existing)
      } else {
        const id = crypto.randomUUID()
        sessionStorage.setItem('sessionId', id)
        setSessionId(id)
        m.pushLog('Session started: ' + id)
      }
    } catch {}
  }, [])

  // Greet and begin the interview loop when ready
  useEffect(() => {
    if (!sessionId || runningRef.current) return
    runningRef.current = true
    speak(OPENING)
    m.pushLog('Assistant reply ready → playing')
    setTimeout(() => {
      runTurnLoop().finally(() => { runningRef.current = false })
    }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const runTurnLoop = useCallback(async () => {
    if (!sessionId) return
    if (inTurnRef.current) return
    inTurnRef.current = true
    try {
      m.pushLog('Recording started')
      const baseline = await calibrateRMS(2.0)
      const rec = await recordUntilSilence({ baseline, minDurationMs:1200, silenceMs:1600, graceMs:600, shouldForceStop: ()=> false })
      const b64 = await blobToBase64(rec.blob)
      m.pushLog('Recording stopped → thinking')

      const askRes = await fetch('/api/ask-audio', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: b64, format: 'webm', sessionId, turn: turn+1 })
      }).then(r=>r.json()).catch(()=>({ reply:"Tell me one small detail you remember from that moment.", transcript:"", end_intent:false }))
      const reply: string = askRes?.reply || "Tell me one small detail you remember from that moment."
      const transcript: string = askRes?.transcript || ''
      const endIntent: boolean = askRes?.end_intent === true
      const endRegex = /(i[' ]?m done|stop for now|that's all|i'm finished|we're done|let's stop)/i

      await fetch('/api/save-turn', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, turn: turn+1, wav: b64, mime:'audio/webm', duration_ms: rec.durationMs, reply_text: reply, transcript, provider: 'google' })
      }).then(r=>{ if(!r.ok) throw new Error('save-failed') })

      setTurn(t => t + 1)

      speak(reply)
      m.pushLog('Assistant reply ready → playing')
      setTimeout(() => {
        m.pushLog('Finished playing → ready')
        // Check for end intent or explicit stop phrases
        const shouldEnd = endIntent || (transcript && endRegex.test(transcript))
        if (!shouldEnd) {
          m.pushLog('Continue → recording')
          inTurnRef.current = false
          runTurnLoop()
        }
        if (shouldEnd) {
          inTurnRef.current = false
        }
      }, 600)
    } catch (e) {
      m.pushLog('There was a problem saving or asking. Check /api/health and env keys.')
      inTurnRef.current = false
    }
  }, [m, sessionId, turn])

  useEffect(() => {
    if (m.state === 'recording' && !sessionId) {
      fetch('/api/session/start', { method: 'POST' })
        .then(r => r.json())
        .then(d => { setSessionId(d?.id); m.pushLog('Session started: ' + d?.id) })
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
                const res = await fetch(`/api/finalize-session`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionId })
                })
                const out = await res.json()
                m.pushLog('Finalized: ' + JSON.stringify(out, null, 2))
                m.toDone()
              } catch (e) {
                m.pushLog('Finalize failed')
              } finally {
                m.setDisabled(false)
              }
            }}
            className="text-sm bg-white/10 px-3 py-1 rounded-2xl"
          >
            Finish Session
          </button>
          <button onClick={()=> speak('Okay, continuing when you are ready.')} className="text-sm bg-white/10 px-3 py-1 rounded-2xl">Speak</button>
        </div>

        <div className="w-full max-w-xl">
          <label className="text-xs opacity-70">On-screen Log (copy to share diagnostics):</label>
          <textarea value={m.debugLog.join('\n')} readOnly className="w-full h-56 bg-black/30 p-2 rounded" />
          <div className="mt-2 text-xs opacity-70">Need more? Visit <a className="underline" href="/diagnostics">Diagnostics</a>.</div>
        </div>
      </div>
    </main>
  )
}
