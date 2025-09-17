"use client"
import { useInterviewMachine } from '@/lib/machine'
import { speak } from '@/lib/tts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from '@/lib/audio-bridge'

// DEMO/TEST MODE: Shortened greeting for faster testing
const OPENING = `Start testing greeting. Answer a question.`

export default function Home() {
  const m = useInterviewMachine()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turn, setTurn] = useState<number>(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [disabledNext, setDisabledNext] = useState(false)
  const inTurnRef = useRef(false)
  // DEMO/TEST MODE: only 1 turn before finalize
  const MAX_TURNS = 1

  async function finalizeNow(){
    if (!sessionId) return
    try{
      const [legacyRes, memRes] = await Promise.allSettled([
        fetch(`/api/finalize-session`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId }) }),
        fetch(`/api/session/${sessionId}/finalize`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ clientDurationMs: 0 }) })
      ])

      async function inspect(label: string, result: PromiseSettledResult<Response>) {
        if (result.status !== 'fulfilled') {
          const reason = result.reason instanceof Error ? result.reason.message : 'request_failed'
          m.pushLog(`${label} failed: ${reason}`)
          return false
        }
        let payload: any = null
        try {
          payload = await result.value.clone().json()
          m.pushLog(`${label}: ` + JSON.stringify(payload))
        } catch {}
        if (!result.value.ok || (payload && payload.ok === false)) {
          m.pushLog(`${label} not ok (status ${result.value.status})`)
          return false
        }
        return true
      }

      const legacyOk = await inspect('Finalized (blob)', legacyRes)
      const memOk = await inspect('Finalized (mem)', memRes)
      if (!legacyOk || !memOk) throw new Error('Finalize failed')

      // DEMO: also persist a minimal client-side history record so History page has entries even without server memory/blob
      try {
        const demo = JSON.parse(localStorage.getItem('demoHistory')||'[]')
        const stamp = new Date().toISOString()
        demo.unshift({ id: sessionId, created_at: stamp })
        localStorage.setItem('demoHistory', JSON.stringify(demo.slice(0,50)))
      } catch {}
      m.toDone()
      setDisabledNext(false)
    }catch{
      m.pushLog('Finalize failed')
      setDisabledNext(false)
    }
  }

  // Create a server-backed session id (for history), fallback to existing client id
  useEffect(() => {
    try {
      fetch('/api/session/start', { method: 'POST' })
        .then(r=>r.json())
        .then(d => {
          const id = d?.id || crypto.randomUUID()
          sessionStorage.setItem('sessionId', id)
          setSessionId(id)
          m.pushLog('Session started: ' + id)
        })
        .catch(() => {
          const existing = sessionStorage.getItem('sessionId')
          const id = existing || crypto.randomUUID()
          sessionStorage.setItem('sessionId', id)
          setSessionId(id)
          m.pushLog('Session started: ' + id)
        })
    } catch {}
  }, [])

  // No auto-start; greeting is spoken on first Next click

  const runTurnLoop = useCallback(async () => {
    if (!sessionId) return
    if (inTurnRef.current) return
    inTurnRef.current = true
    setDisabledNext(true)
    try {
      m.pushLog('Recording started')
      let b64 = ''
      let recDuration = 0
      try {
        const baseline = await calibrateRMS(0.5)
        const rec = await recordUntilSilence({ baseline, minDurationMs:600, silenceMs:800, graceMs:200, shouldForceStop: ()=> false })
        b64 = await blobToBase64(rec.blob)
        recDuration = rec.durationMs || 0
      } catch {
        const silent = new Blob([new Uint8Array(1)], { type: 'audio/webm' })
        b64 = await blobToBase64(silent)
        recDuration = 500
      }
      m.pushLog('Recording stopped → thinking')

      const askRes = await fetch('/api/ask-audio', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: b64, format: 'webm', sessionId, turn: turn+1 })
      }).then(r=>r.json()).catch(()=>({ reply:"Tell me one small detail you remember from that moment.", transcript:"", end_intent:false }))
      const reply: string = askRes?.reply || "Tell me one small detail you remember from that moment."
      const transcript: string = askRes?.transcript || ''
      const endIntent: boolean = askRes?.end_intent === true
      const endRegex = /(i[' ]?m done|stop for now|that's all|i'm finished|we're done|let's stop)/i

      // Persist artifacts and history (non-fatal if any fail)
      const persistPromises: Promise<any>[] = []
      persistPromises.push(fetch('/api/save-turn', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, turn: turn+1, wav: b64, mime:'audio/webm', duration_ms: recDuration, reply_text: reply, transcript, provider: 'google' })
      }))
      persistPromises.push(fetch(`/api/session/${sessionId}/turn`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role:'user', text: transcript || '' })
      }))
      persistPromises.push(fetch(`/api/session/${sessionId}/turn`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role:'assistant', text: reply || '' })
      }))
      try { await Promise.allSettled(persistPromises) } catch {}

      const nextTurn = turn + 1
      setTurn(nextTurn)

      const u = new SpeechSynthesisUtterance(reply)
      u.rate = 1; u.pitch = 1
      u.onend = () => {
        m.pushLog('Finished playing → ready')
        const reachedMax = nextTurn >= MAX_TURNS
        const shouldEnd = endIntent || reachedMax || (transcript && endRegex.test(transcript))
        inTurnRef.current = false
        if (shouldEnd) finalizeNow()
      }
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        // TODO(later): offer an opt-in flag here that pipes the assistant response through
        // the OpenAI NeuralHD voices for higher fidelity playback once the backend wiring is ready.
      } catch {}
      m.pushLog('Assistant reply ready → playing')
    } catch (e) {
      m.pushLog('There was a problem saving or asking. Check /api/health and env keys.')
      inTurnRef.current = false
      setDisabledNext(false)
    }
  }, [m, sessionId, turn])

  // Single-button flow handler
  const onNext = useCallback(() => {
    if (disabledNext) return
    if (!hasStarted) {
      setHasStarted(true)
      try {
        const u = new SpeechSynthesisUtterance(OPENING)
        u.rate = 1; u.pitch = 1
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        // REMINDER: consider progressive playback (streaming audio chunks) so the UI stays responsive
        // when we switch to OpenAI-powered TTS.
        m.pushLog('Assistant reply ready → playing')
      } catch {}
      return
    }
    if (!inTurnRef.current) runTurnLoop()
  }, [hasStarted, runTurnLoop, disabledNext])

  return (
    <main className="mt-8">
      <div className="flex flex-col items-center gap-6">
        <div className="text-sm opacity-80">{!hasStarted ? 'Ready' : 'Tap Next to continue'}</div>

        <div className="flex gap-3">
          {m.state !== 'doneSuccess' ? (
            <button onClick={onNext} disabled={disabledNext} className="text-sm bg-white/10 px-3 py-1 rounded-2xl disabled:opacity-50">Next</button>
          ) : (
            <button onClick={()=>{ setHasStarted(false); setTurn(0); }} className="text-sm bg-white/10 px-3 py-1 rounded-2xl">Start Again</button>
          )}
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
