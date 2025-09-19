"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInterviewMachine } from '@/lib/machine'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from '@/lib/audio-bridge'
import { createSessionRecorder, SessionRecorder } from '@/lib/session-recorder'

const OPENING = `Start testing greeting. Answer a question.`

type AssistantPlayback = {
  base64: string | null
  mime: string
  durationMs: number
}

export default function Home() {
  const m = useInterviewMachine()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turn, setTurn] = useState<number>(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [disabledNext, setDisabledNext] = useState(false)
  const [finishRequested, setFinishRequested] = useState(false)
  const inTurnRef = useRef(false)
  const recorderRef = useRef<SessionRecorder | null>(null)
  const sessionAudioUrlRef = useRef<string | null>(null)
  const sessionAudioDurationRef = useRef<number>(0)
  const finishRequestedRef = useRef(false)

  const MAX_TURNS = Number.POSITIVE_INFINITY

  useEffect(() => {
    finishRequestedRef.current = finishRequested
  }, [finishRequested])

  useEffect(() => {
    try {
      fetch('/api/session/start', { method: 'POST' })
        .then((r) => r.json())
        .then((d) => {
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
          m.pushLog('Session started (fallback): ' + id)
        })
    } catch {}
  }, [m])

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.cancel()
      } catch {}
      recorderRef.current = null
    }
  }, [])

  const ensureSessionRecorder = useCallback(async () => {
    if (typeof window === 'undefined') return null
    if (!recorderRef.current) {
      recorderRef.current = createSessionRecorder()
    }
    try {
      await recorderRef.current.start()
      return recorderRef.current
    } catch (err) {
      recorderRef.current?.cancel()
      recorderRef.current = null
      throw err
    }
  }, [])

  const playWithAudioElement = useCallback(async (base64: string, mime: string) => {
    if (typeof window === 'undefined') return 0
    return await new Promise<number>((resolve) => {
      try {
        const src = `data:${mime};base64,${base64}`
        const audio = new Audio(src)
        audio.onended = () => {
          resolve(Math.round((audio.duration || 0) * 1000))
        }
        audio.onerror = () => resolve(0)
        audio.play().catch(() => resolve(0))
      } catch {
        resolve(0)
      }
    })
  }, [])

  const playWithSpeechSynthesis = useCallback(async (text: string) => {
    if (typeof window === 'undefined') return 0
    return await new Promise<number>((resolve) => {
      try {
        if (!('speechSynthesis' in window)) {
          resolve(0)
          return
        }
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = 1
        utterance.pitch = 1
        utterance.onend = () => resolve(0)
        utterance.onerror = () => resolve(0)
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utterance)
      } catch {
        resolve(0)
      }
    })
  }, [])

  const playAssistantResponse = useCallback(
    async (text: string): Promise<AssistantPlayback> => {
      if (!text) return { base64: null, mime: 'audio/mpeg', durationMs: 0 }
      m.pushLog('Assistant reply ready → playing')
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!res.ok) throw new Error('tts_failed')
        const data = await res.json()
        if (!data?.audioBase64 || typeof data.audioBase64 !== 'string') {
          throw new Error('tts_invalid')
        }
        const mime = typeof data.mime === 'string' ? data.mime : 'audio/mpeg'
        let durationMs = 0
        const recorder = recorderRef.current
        if (recorder) {
          try {
            const playback = await recorder.playAssistantBase64(data.audioBase64, mime)
            durationMs = playback?.durationMs ?? 0
          } catch (err) {
            m.pushLog('Recorder playback failed, falling back to direct audio')
            durationMs = await playWithAudioElement(data.audioBase64, mime)
          }
        } else {
          durationMs = await playWithAudioElement(data.audioBase64, mime)
        }
        return { base64: data.audioBase64, mime, durationMs }
      } catch (err) {
        m.pushLog('TTS unavailable, using speech synthesis fallback')
        const durationMs = await playWithSpeechSynthesis(text)
        return { base64: null, mime: 'audio/mpeg', durationMs }
      }
    },
    [m, playWithAudioElement, playWithSpeechSynthesis],
  )

  const finalizeNow = useCallback(async () => {
    if (!sessionId) return
    setDisabledNext(true)
    try {
      let sessionAudioUrl = sessionAudioUrlRef.current
      let sessionAudioDurationMs = sessionAudioDurationRef.current

      if (!sessionAudioUrl && recorderRef.current) {
        try {
          const recording = await recorderRef.current.stop()
          recorderRef.current = null
          const base64 = await blobToBase64(recording.blob)
          sessionAudioDurationMs = recording.durationMs
          if (base64) {
            const saveRes = await fetch('/api/save-session-audio', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                audio: base64,
                mime: recording.mimeType || 'audio/webm',
                duration_ms: recording.durationMs,
              }),
            })
            const saveJson = await saveRes.json().catch(() => null)
            if (saveRes.ok && saveJson?.ok) {
              sessionAudioUrl = typeof saveJson.url === 'string' ? saveJson.url : null
              if (typeof saveJson?.durationMs === 'number') {
                sessionAudioDurationMs = saveJson.durationMs
              }
            } else {
              m.pushLog('Failed to store session audio')
            }
          }
        } catch (err) {
          m.pushLog('Session audio capture failed')
          try {
            recorderRef.current?.cancel()
          } catch {}
          recorderRef.current = null
        }
      }

      sessionAudioUrlRef.current = sessionAudioUrl
      sessionAudioDurationRef.current = sessionAudioDurationMs

      const payload = {
        sessionId,
        sessionAudioUrl: sessionAudioUrl || undefined,
        sessionAudioDurationMs: sessionAudioDurationMs || undefined,
      }

      async function inspect(label: string, response: Response | null, options?: { optional?: boolean }) {
        if (!response) {
          m.pushLog(`${label} failed: no response`)
          return false
        }
        let payload: any = null
        let logged = false
        try {
          payload = await response.clone().json()
          m.pushLog(`${label}: ` + JSON.stringify(payload))
          logged = true
        } catch {
          try {
            const text = await response.clone().text()
            if (text.trim().length) {
              m.pushLog(`${label}: ${text}`)
              logged = true
            }
          } catch {}
        }
        if (!logged) {
          m.pushLog(`${label}: status ${response.status}`)
        }

        const payloadError = payload && typeof payload.error === 'string' ? payload.error : null
        const shouldIgnoreMissingSession =
          options?.optional && payloadError && /session not found/i.test(payloadError)

        if (!response.ok || (payload && payload.ok === false)) {
          if (shouldIgnoreMissingSession) {
            m.pushLog(`${label} skipped (stateless runtime)`)
            return true
          }
          m.pushLog(`${label} not ok (status ${response.status})`)
          return false
        }
        return true
      }

      let legacyRes: Response | null = null
      try {
        legacyRes = await fetch(`/api/finalize-session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'request_failed'
        m.pushLog(`Finalized (blob) failed: ${message}`)
        throw err
      }

      const legacyOk = await inspect('Finalized (blob)', legacyRes)
      if (!legacyOk) throw new Error('Finalize failed')

      let memOk = true
      try {
        const memRes = await fetch(`/api/session/${sessionId}/finalize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientDurationMs: sessionAudioDurationMs,
            sessionAudioUrl: sessionAudioUrl || undefined,
          }),
        })
        memOk = await inspect('Finalized (mem)', memRes, { optional: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'request_failed'
        m.pushLog(`Finalized (mem) failed: ${message}`)
        memOk = false
      }

      if (!memOk) throw new Error('Finalize failed')

      try {
        const demo = JSON.parse(localStorage.getItem('demoHistory') || '[]')
        const stamp = new Date().toISOString()
        demo.unshift({ id: sessionId, created_at: stamp })
        localStorage.setItem('demoHistory', JSON.stringify(demo.slice(0, 50)))
      } catch {}

      m.toDone()
    } catch {
      m.pushLog('Finalize failed')
    } finally {
      finishRequestedRef.current = false
      setFinishRequested(false)
      setDisabledNext(false)
    }
  }, [m, sessionId])

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
        const rec = await recordUntilSilence({
          baseline,
          minDurationMs: 600,
          silenceMs: 800,
          graceMs: 200,
          shouldForceStop: () => false,
        })
        b64 = await blobToBase64(rec.blob)
        recDuration = rec.durationMs || 0
      } catch {
        const silent = new Blob([new Uint8Array(1)], { type: 'audio/webm' })
        b64 = await blobToBase64(silent)
        recDuration = 500
      }
      m.pushLog('Recording stopped → thinking')

      const askRes = await fetch('/api/ask-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: b64, format: 'webm', sessionId, turn: turn + 1 }),
      })
        .then((r) => r.json())
        .catch(() => ({ reply: 'Tell me one small detail you remember from that moment.', transcript: '', end_intent: false }))

      const reply: string = askRes?.reply || 'Tell me one small detail you remember from that moment.'
      const transcript: string = askRes?.transcript || ''
      const endIntent: boolean = askRes?.end_intent === true
      const endRegex =
        /(i[' ]?m done|i am done|stop for now|that's all|i[' ]?m finished|i am finished|we're done|let's stop|lets stop|all done|that's it|im done now|i[' ]?m good|i am done now)/i

      let assistantPlayback: AssistantPlayback = { base64: null, mime: 'audio/mpeg', durationMs: 0 }
      try {
        assistantPlayback = await playAssistantResponse(reply)
      } catch {
        assistantPlayback = { base64: null, mime: 'audio/mpeg', durationMs: 0 }
      }

      const persistPromises: Promise<any>[] = []
      persistPromises.push(
        fetch('/api/save-turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            turn: turn + 1,
            wav: b64,
            mime: 'audio/webm',
            duration_ms: recDuration,
            reply_text: reply,
            transcript,
            provider: 'google',
            assistant_wav: assistantPlayback.base64 || undefined,
            assistant_mime: assistantPlayback.mime || undefined,
            assistant_duration_ms: assistantPlayback.durationMs || 0,
          }),
        }),
      )
      persistPromises.push(
        fetch(`/api/session/${sessionId}/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'user', text: transcript || '' }),
        }),
      )
      persistPromises.push(
        fetch(`/api/session/${sessionId}/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', text: reply || '' }),
        }),
      )
      try {
        await Promise.allSettled(persistPromises)
      } catch {}

      const nextTurn = turn + 1
      setTurn(nextTurn)

      m.pushLog('Finished playing → ready')
      const reachedMax = nextTurn >= MAX_TURNS
      const shouldEnd =
        finishRequestedRef.current || endIntent || reachedMax || (transcript && endRegex.test(transcript))
      inTurnRef.current = false

      if (shouldEnd) {
        await finalizeNow()
      } else {
        setDisabledNext(false)
      }
    } catch (e) {
      m.pushLog('There was a problem saving or asking. Check /api/health and env keys.')
      inTurnRef.current = false
      setDisabledNext(false)
    }
  }, [MAX_TURNS, finalizeNow, m, playAssistantResponse, sessionId, turn])

  const startSession = useCallback(async () => {
    if (hasStarted) return
    setFinishRequested(false)
    finishRequestedRef.current = false
    setHasStarted(true)
    setDisabledNext(true)
    try {
      try {
        await ensureSessionRecorder()
      } catch {
        m.pushLog('Session recorder unavailable; proceeding without combined audio')
      }
      await playAssistantResponse(OPENING)
    } catch {
      await playWithSpeechSynthesis(OPENING)
    } finally {
      setDisabledNext(false)
    }
  }, [ensureSessionRecorder, hasStarted, m, playAssistantResponse, playWithSpeechSynthesis])

  const requestFinish = useCallback(async () => {
    if (finishRequestedRef.current) return
    setFinishRequested(true)
    m.pushLog('Finish requested by user')
    if (inTurnRef.current) {
      m.pushLog('Finishing after the current turn completes')
      return
    }
    await finalizeNow()
  }, [finalizeNow, m])

  const onNext = useCallback(async () => {
    if (disabledNext) return
    if (!hasStarted) {
      await startSession()
      return
    }
    if (!inTurnRef.current) {
      await runTurnLoop()
    }
  }, [disabledNext, hasStarted, runTurnLoop, startSession])

  return (
    <main className="mt-8">
      <div className="flex flex-col items-center gap-6">
        <div className="text-sm opacity-80">
          {!hasStarted
            ? 'Ready'
            : finishRequested
              ? 'Wrapping up the session'
              : disabledNext
                ? 'Working...'
                : 'Tap Next to continue'}
        </div>

        <div className="flex gap-3">
          {m.state !== 'doneSuccess' ? (
            <button onClick={onNext} disabled={disabledNext} className="text-sm bg-white/10 px-3 py-1 rounded-2xl disabled:opacity-50">
              Next
            </button>
          ) : (
            <button
              onClick={() => {
                try {
                  recorderRef.current?.cancel()
                } catch {}
                recorderRef.current = null
                sessionAudioUrlRef.current = null
                sessionAudioDurationRef.current = 0
                setHasStarted(false)
                setTurn(0)
                setFinishRequested(false)
                finishRequestedRef.current = false
              }}
              className="text-sm bg-white/10 px-3 py-1 rounded-2xl"
            >
              Start Again
            </button>
          )}
          {m.state !== 'doneSuccess' && (
            <button
              onClick={requestFinish}
              disabled={!hasStarted || finishRequested}
              className="text-sm bg-white/10 px-3 py-1 rounded-2xl disabled:opacity-50"
            >
              I'm finished
            </button>
          )}
        </div>

        <div className="w-full max-w-xl">
          <label className="text-xs opacity-70">On-screen Log (copy to share diagnostics):</label>
          <textarea value={m.debugLog.join('\n')} readOnly className="w-full h-56 bg-black/30 p-2 rounded" />
          <div className="mt-2 text-xs opacity-70">
            Need more? Visit <a className="underline" href="/diagnostics">Diagnostics</a>.
          </div>
        </div>
      </div>
    </main>
  )
}
