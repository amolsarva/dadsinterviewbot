"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInterviewMachine } from '@/lib/machine'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from '@/lib/audio-bridge'
import { createSessionRecorder, SessionRecorder } from '@/lib/session-recorder'

const SESSION_STORAGE_KEY = 'sessionId'

type SessionInitSource = 'memory' | 'storage' | 'network' | 'fallback'

type SessionInitResult = {
  id: string
  source: SessionInitSource
}

type NetworkSessionResult = {
  id: string
  source: Extract<SessionInitSource, 'network' | 'fallback'>
}

let inMemorySessionId: string | null = null
let sessionStartPromise: Promise<NetworkSessionResult> | null = null

const createLocalSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

const readStoredSessionId = () => {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    return stored && typeof stored === 'string' ? stored : null
  } catch {
    return null
  }
}

const persistSessionId = (id: string) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, id)
  } catch {}
}

const requestNewSessionId = async (): Promise<NetworkSessionResult> => {
  if (typeof window === 'undefined') {
    const fallbackId = createLocalSessionId()
    return { id: fallbackId, source: 'fallback' as const }
  }

  try {
    const res = await fetch('/api/session/start', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    const id = typeof data?.id === 'string' && data.id ? data.id : createLocalSessionId()
    const source: NetworkSessionResult['source'] =
      typeof data?.id === 'string' && data.id ? 'network' : 'fallback'
    inMemorySessionId = id
    persistSessionId(id)
    return { id, source }
  } catch {
    let id = readStoredSessionId()
    if (!id) {
      id = createLocalSessionId()
    }
    inMemorySessionId = id
    persistSessionId(id)
    return { id, source: 'fallback' as const }
  }
}

const ensureSessionIdOnce = async (): Promise<SessionInitResult> => {
  if (inMemorySessionId) {
    return { id: inMemorySessionId, source: 'memory' }
  }

  const stored = readStoredSessionId()
  if (stored) {
    inMemorySessionId = stored
    return { id: stored, source: 'storage' }
  }

  if (!sessionStartPromise) {
    sessionStartPromise = requestNewSessionId().finally(() => {
      sessionStartPromise = null
    })
  }

  const result = await sessionStartPromise
  return result
}

const OPENING = `OK. I'm here to interview you. Let's get started.`
const TTS_VOICE = 'alloy'
const END_REGEX =
  /(i[' ]?m done|i am done|stop for now|that's all|i[' ]?m finished|i am finished|we[' ]?re done|let[' ]?s stop|lets stop|all done|that's it|that's it for today|that's everything|that's enough|im done now|i[' ]?m good|i am done now|we can stop|we[' ]?re good|that's good for now)/i

type AssistantPlayback = {
  base64: string | null
  mime: string
  durationMs: number
  voice?: string | null
  format?: string | null
}

export default function Home() {
  const machineState = useInterviewMachine((state) => state.state)
  const debugLog = useInterviewMachine((state) => state.debugLog)
  const pushLog = useInterviewMachine((state) => state.pushLog)
  const toDone = useInterviewMachine((state) => state.toDone)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turn, setTurn] = useState<number>(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [phase, setPhase] = useState<
    | 'initializing'
    | 'calibrating'
    | 'speaking'
    | 'listening'
    | 'thinking'
    | 'idle'
    | 'finished'
  >('initializing')
  const [finishRequested, setFinishRequested] = useState(false)
  const inTurnRef = useRef(false)
  const recorderRef = useRef<SessionRecorder | null>(null)
  const sessionAudioUrlRef = useRef<string | null>(null)
  const sessionAudioDurationRef = useRef<number>(0)
  const finishRequestedRef = useRef(false)
  const sessionInitRef = useRef(false)
  const lastAnnouncedSessionIdRef = useRef<string | null>(null)
  const askAbortRef = useRef<AbortController | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const playbackStopRef = useRef<(() => void) | null>(null)
  const recorderStartedRef = useRef(false)

  const MAX_TURNS = Number.POSITIVE_INFINITY

  useEffect(() => {
    finishRequestedRef.current = finishRequested
  }, [finishRequested])

  const stopActivePlayback = useCallback(() => {
    const stop = playbackStopRef.current
    playbackStopRef.current = null
    if (stop) {
      try {
        stop()
      } catch {}
    }
  }, [])

  const abortAsk = useCallback(() => {
    const controller = askAbortRef.current
    askAbortRef.current = null
    if (controller) {
      try {
        controller.abort()
      } catch {}
    }
  }, [])

  const abortTts = useCallback(() => {
    const controller = ttsAbortRef.current
    ttsAbortRef.current = null
    if (controller) {
      try {
        controller.abort()
      } catch {}
    }
  }, [])

  useEffect(() => {
    return () => {
      stopActivePlayback()
      abortAsk()
      abortTts()
      try {
        recorderRef.current?.cancel()
      } catch {}
      recorderRef.current = null
      recorderStartedRef.current = false
    }
  }, [abortAsk, abortTts, stopActivePlayback])

  useEffect(() => {
    if (sessionInitRef.current) return
    sessionInitRef.current = true
    if (typeof window === 'undefined') return

    let cancelled = false

    ensureSessionIdOnce()
      .then((result) => {
        if (cancelled) return
        setSessionId(result.id)

        if (lastAnnouncedSessionIdRef.current === result.id) return
        lastAnnouncedSessionIdRef.current = result.id

        if (result.source === 'network') {
          pushLog('Session started: ' + result.id)
        } else if (result.source === 'fallback') {
          pushLog('Session started (fallback): ' + result.id)
        } else {
          pushLog('Session resumed: ' + result.id)
        }
      })
      .catch(() => {
        if (cancelled) return
        const fallbackId = createLocalSessionId()
        inMemorySessionId = fallbackId
        persistSessionId(fallbackId)
        setSessionId(fallbackId)
        if (lastAnnouncedSessionIdRef.current !== fallbackId) {
          lastAnnouncedSessionIdRef.current = fallbackId
          pushLog('Session started (fallback): ' + fallbackId)
        }
      })

    return () => {
      cancelled = true
    }
  }, [pushLog])

  const ensureSessionRecorder = useCallback(async () => {
    if (typeof window === 'undefined') return null
    if (!recorderRef.current) {
      recorderRef.current = createSessionRecorder()
    }
    try {
      await recorderRef.current.start()
      if (!recorderStartedRef.current) {
        recorderStartedRef.current = true
        pushLog('Session recorder armed (capturing merged audio)')
      }
      return recorderRef.current
    } catch (err) {
      recorderRef.current?.cancel()
      recorderRef.current = null
      recorderStartedRef.current = false
      throw err
    }
  }, [pushLog])

  const playAssistantResponse = useCallback(
    async (text: string, meta?: { label?: string; voice?: string | null }): Promise<AssistantPlayback> => {
      const label = meta?.label || 'assistant'
      if (!text) {
        pushLog(`[${label}] No assistant reply text provided`)
        return { base64: null, mime: 'audio/mpeg', durationMs: 0, voice: meta?.voice ?? null, format: null }
      }
      if (finishRequestedRef.current) {
        pushLog(`[${label}] Skipping playback because finish was requested`)
        return { base64: null, mime: 'audio/mpeg', durationMs: 0, voice: meta?.voice ?? null, format: null }
      }

      stopActivePlayback()
      abortTts()

      pushLog(`[${label}] Requesting TTS (voice ${meta?.voice || TTS_VOICE})`)
      const controller = new AbortController()
      ttsAbortRef.current = controller
      let response: Response
      try {
        response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, voice: meta?.voice || TTS_VOICE }),
          signal: controller.signal,
        })
      } catch (err) {
        if (controller.signal.aborted) {
          pushLog(`[${label}] TTS request aborted`)
          throw new Error('tts_aborted')
        }
        const message = err instanceof Error ? err.message : 'request_failed'
        pushLog(`[${label}] TTS request failed (${message})`)
        throw err instanceof Error ? err : new Error(message)
      } finally {
        if (ttsAbortRef.current === controller) {
          ttsAbortRef.current = null
        }
      }

      if (!response.ok) {
        pushLog(`[${label}] TTS response not ok (status ${response.status})`)
        throw new Error('tts_failed')
      }

      let payload: any = null
      try {
        payload = await response.json()
      } catch (err) {
        pushLog(`[${label}] Failed to decode TTS response JSON`)
        throw err instanceof Error ? err : new Error('tts_invalid')
      }

      const base64 = typeof payload?.audioBase64 === 'string' ? payload.audioBase64 : ''
      if (!base64) {
        pushLog(`[${label}] TTS response missing audio data`)
        throw new Error('tts_invalid')
      }
      const mime = typeof payload?.mime === 'string' ? payload.mime : 'audio/mpeg'
      const format = typeof payload?.format === 'string' ? payload.format : null
      const voice = typeof payload?.voice === 'string' ? payload.voice : meta?.voice || TTS_VOICE

      pushLog(`[${label}] TTS ready (voice ${voice}${format ? `, format ${format}` : ''})`)

      let durationMs = 0
      const recorder = recorderRef.current
      if (recorder) {
        const stopPlayback = () => {
          try {
            recorder.stopPlayback()
          } catch {}
        }
        playbackStopRef.current = stopPlayback
        try {
          const playback = await recorder.playAssistantBase64(base64, mime)
          durationMs = playback?.durationMs ?? 0
        } catch (err) {
          const message = err instanceof Error ? err.message : 'play_failed'
          pushLog(`[${label}] Recorder playback failed (${message}); falling back to audio element`)
        } finally {
          if (playbackStopRef.current === stopPlayback) {
            playbackStopRef.current = null
          }
        }
      }

      if (!durationMs) {
        durationMs = await new Promise<number>((resolve) => {
          if (typeof window === 'undefined') {
            resolve(0)
            return
          }
          const src = `data:${mime};base64,${base64}`
          const audio = new Audio(src)
          let settled = false
          const cleanup = (ms: number) => {
            if (settled) return
            settled = true
            try {
              audio.pause()
            } catch {}
            try {
              audio.removeAttribute('src')
              audio.load()
            } catch {}
            resolve(ms)
          }
          const stopPlayback = () => {
            cleanup(Math.round((audio.duration || 0) * 1000))
          }
          playbackStopRef.current = stopPlayback
          audio.onended = () => {
            if (playbackStopRef.current === stopPlayback) {
              playbackStopRef.current = null
            }
            cleanup(Math.round((audio.duration || 0) * 1000))
          }
          audio.onerror = () => {
            if (playbackStopRef.current === stopPlayback) {
              playbackStopRef.current = null
            }
            cleanup(0)
          }
          audio.play().catch((err) => {
            const message = err instanceof Error ? err.message : 'play_failed'
            pushLog(`[${label}] Audio element playback failed (${message})`)
            if (playbackStopRef.current === stopPlayback) {
              playbackStopRef.current = null
            }
            cleanup(0)
          })
        })
      }

      pushLog(`[${label}] Playback complete (${durationMs} ms)`)
      return { base64, mime, durationMs, voice, format }
    },
    [abortTts, pushLog, stopActivePlayback],
  )

  const finalizeNow = useCallback(async () => {
    if (!sessionId) return false
    stopActivePlayback()
    abortAsk()
    abortTts()
    pushLog('Finalizing session…')
    try {
      let sessionAudioUrl = sessionAudioUrlRef.current
      let sessionAudioDurationMs = sessionAudioDurationRef.current

      if (!sessionAudioUrl && recorderRef.current) {
        try {
          const recording = await recorderRef.current.stop()
          recorderRef.current = null
          recorderStartedRef.current = false
          const base64 = await blobToBase64(recording.blob)
          sessionAudioDurationMs = recording.durationMs
          if (base64) {
            pushLog('Uploading combined session audio')
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
              pushLog('Session audio stored successfully')
            } else {
              pushLog('Failed to store session audio')
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'recorder_failed'
          pushLog(`Session audio capture failed (${message})`)
          try {
            recorderRef.current?.cancel()
          } catch {}
          recorderRef.current = null
          recorderStartedRef.current = false
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
          pushLog(`${label} failed: no response`)
          return false
        }
        let payload: any = null
        let logged = false
        try {
          payload = await response.clone().json()
          pushLog(`${label}: ` + JSON.stringify(payload))
          logged = true
        } catch {
          try {
            const text = await response.clone().text()
            if (text.trim().length) {
              pushLog(`${label}: ${text}`)
              logged = true
            }
          } catch {}
        }
        if (!logged) {
          pushLog(`${label}: status ${response.status}`)
        }

        const payloadError = payload && typeof payload.error === 'string' ? payload.error : null
        const shouldIgnoreMissingSession =
          options?.optional && payloadError && /session not found/i.test(payloadError)

        if (!response.ok || (payload && payload.ok === false)) {
          if (shouldIgnoreMissingSession) {
            pushLog(`${label} skipped (stateless runtime)`)
            return true
          }
          pushLog(`${label} not ok (status ${response.status})`)
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
        pushLog(`Finalized (blob) failed: ${message}`)
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
        pushLog(`Finalized (mem) failed: ${message}`)
        memOk = false
      }

      if (!memOk) throw new Error('Finalize failed')

      try {
        const demo = JSON.parse(localStorage.getItem('demoHistory') || '[]')
        const stamp = new Date().toISOString()
        demo.unshift({ id: sessionId, created_at: stamp })
        localStorage.setItem('demoHistory', JSON.stringify(demo.slice(0, 50)))
      } catch {}

      toDone()
      pushLog('Session finalized successfully')
      return true
    } catch {
      pushLog('Finalize failed')
      return false
    } finally {
      finishRequestedRef.current = false
      setFinishRequested(false)
    }
  }, [abortAsk, abortTts, pushLog, sessionId, stopActivePlayback, toDone])

  const runTurnLoop = useCallback(async () => {
    if (!sessionId) return
    if (inTurnRef.current) return
    if (finishRequestedRef.current) {
      pushLog('Finish requested before turn loop; finalizing now')
      setPhase('thinking')
      const ok = await finalizeNow()
      setPhase(ok ? 'finished' : 'idle')
      return
    }

    inTurnRef.current = true
    let currentTurn = turn
    let didFinalize = false

    try {
      while (!finishRequestedRef.current) {
        const turnNumber = currentTurn + 1
        const turnLabel = `turn ${turnNumber}`
        pushLog(`[${turnLabel}] Starting turn`)
        setPhase('calibrating')
        pushLog(`[${turnLabel}] Calibrating microphone…`)
        let baseline = 0.05
        try {
          const measured = await calibrateRMS(0.75)
          if (Number.isFinite(measured) && measured > 0.00001) {
            baseline = measured
          }
          pushLog(`[${turnLabel}] Baseline RMS ≈ ${baseline.toFixed(3)}`)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'calibration_failed'
          pushLog(`[${turnLabel}] Calibration failed (${message}); using fallback baseline`)
        }

        if (finishRequestedRef.current) {
          pushLog(`[${turnLabel}] Finish requested during calibration`)
          break
        }

        setPhase('listening')
        pushLog(`[${turnLabel}] Recording started (baseline ≈ ${baseline.toFixed(3)})`)
        let b64 = ''
        let recDuration = 0
        let recordingMime = 'audio/webm;codecs=opus'
        try {
          const rec = await recordUntilSilence({
            baseline: Math.max(0.01, baseline),
            minDurationMs: 600,
            silenceMs: 800,
            graceMs: 200,
            maxDurationMs: 45000,
            maxWaitMs: 5000,
            shouldForceStop: () => finishRequestedRef.current,
          })
          b64 = await blobToBase64(rec.blob)
          recDuration = rec.durationMs || 0
          if (rec.mimeType) {
            recordingMime = rec.mimeType
          }
          pushLog(`[${turnLabel}] Recording captured ${recDuration} ms`)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'record_failed'
          pushLog(`[${turnLabel}] Recording failed (${message}); substituting silence`)
          const silent = new Blob([new Uint8Array(1)], { type: recordingMime })
          b64 = await blobToBase64(silent)
          recDuration = 500
        }

        if (finishRequestedRef.current) {
          pushLog(`[${turnLabel}] Finish requested during recording`)
          setPhase('thinking')
          break
        }

        pushLog(`[${turnLabel}] Recording stopped → thinking`)
        setPhase('thinking')

        abortAsk()
        const controller = new AbortController()
        askAbortRef.current = controller
        let askData: any = null
        try {
          pushLog(`[${turnLabel}] Sending audio to ask-audio API`)
          const askResponse = await fetch('/api/ask-audio', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audio: b64, format: 'webm', mime: recordingMime, sessionId, turn: turnNumber }),
            signal: controller.signal,
          })
          askData = await askResponse.json().catch(() => null)
        } catch (err) {
          if (controller.signal.aborted) {
            pushLog(`[${turnLabel}] ask-audio request aborted`)
            break
          }
          const message = err instanceof Error ? err.message : 'ask_failed'
          pushLog(`[${turnLabel}] ask-audio request failed (${message}); using fallback reply`)
        } finally {
          if (askAbortRef.current === controller) {
            askAbortRef.current = null
          }
        }

        if (!askData) {
          askData = {
            reply: 'Tell me one small detail you remember from that moment.',
            transcript: '',
            end_intent: false,
            provider: 'fallback',
          }
        }

        const reply: string =
          typeof askData?.reply === 'string' && askData.reply
            ? askData.reply
            : 'Tell me one small detail you remember from that moment.'
        const transcript: string = typeof askData?.transcript === 'string' ? askData.transcript : ''
        const endIntent: boolean = askData?.end_intent === true
        const provider: string = typeof askData?.provider === 'string' ? askData.provider : 'unknown'

        pushLog(
          `[${turnLabel}] Provider ${provider} responded (reply ${reply.length} chars, transcript ${transcript.length} chars)`,
        )
        if (endIntent && !finishRequestedRef.current) {
          pushLog(`[${turnLabel}] Provider suggested ending the session`)
          finishRequestedRef.current = true
          setFinishRequested(true)
        }

        if (finishRequestedRef.current) {
          pushLog(`[${turnLabel}] Finish requested before playback`)
          break
        }

        setPhase('speaking')
        let assistantPlayback: AssistantPlayback = { base64: null, mime: 'audio/mpeg', durationMs: 0, voice: null, format: null }
        try {
          assistantPlayback = await playAssistantResponse(reply, { label: turnLabel })
        } catch (err) {
          if (finishRequestedRef.current || (err instanceof Error && err.message === 'tts_aborted')) {
            pushLog(`[${turnLabel}] Playback aborted`)
            break
          }
          const message = err instanceof Error ? err.message : 'tts_failed'
          pushLog(`[${turnLabel}] Playback failed (${message}); continuing without audio`)
          assistantPlayback = { base64: null, mime: 'audio/mpeg', durationMs: 0, voice: null, format: null }
        }

        pushLog(
          `[${turnLabel}] Finished playing → ready (${assistantPlayback.durationMs} ms audio, voice ${
            assistantPlayback.voice || TTS_VOICE
          })`,
        )

        const persistPromises: Promise<any>[] = []
        pushLog(`[${turnLabel}] Persisting turn artifacts`)
        persistPromises.push(
          fetch('/api/save-turn', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              turn: turnNumber,
              wav: b64,
              mime: recordingMime,
              duration_ms: recDuration,
              reply_text: reply,
              transcript,
              provider,
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
          pushLog(`[${turnLabel}] Persistence complete`)
        } catch {
          pushLog(`[${turnLabel}] Persistence experienced an error`)
          // Persistence failures shouldn't block the turn loop
        }

        currentTurn += 1
        setTurn(currentTurn)

        const reachedMax = currentTurn >= MAX_TURNS
        const transcriptSignalsEnd = transcript && END_REGEX.test(transcript)
        if (transcriptSignalsEnd && !finishRequestedRef.current) {
          pushLog(`[${turnLabel}] Detected user request to finish`)
          finishRequestedRef.current = true
          setFinishRequested(true)
        }
        const reasons: string[] = []
        if (finishRequestedRef.current) reasons.push('finish requested')
        if (endIntent) reasons.push('assistant end intent')
        if (transcriptSignalsEnd) reasons.push('user said done')
        if (reachedMax) reasons.push('max turns')

        if (reasons.length) {
          pushLog(`[${turnLabel}] Ending session (${reasons.join(', ')})`)
          setPhase('thinking')
          const ok = await finalizeNow()
          setPhase(ok ? 'finished' : 'idle')
          didFinalize = ok
          break
        }

        if (!finishRequestedRef.current) {
          setPhase('calibrating')
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown_error'
      pushLog(`Turn loop error: ${message}. Check /api/health and env keys.`)
      setPhase('idle')
    } finally {
      inTurnRef.current = false
    }

    if (!didFinalize && finishRequestedRef.current) {
      pushLog('Finalize requested after loop exit')
      setPhase('thinking')
      const ok = await finalizeNow()
      setPhase(ok ? 'finished' : 'idle')
    }
  }, [END_REGEX, MAX_TURNS, abortAsk, finalizeNow, playAssistantResponse, pushLog, sessionId, setFinishRequested, turn])

  const startSession = useCallback(async () => {
    if (hasStarted || !sessionId) return
    setFinishRequested(false)
    finishRequestedRef.current = false
    setHasStarted(true)
    pushLog('Session auto-started')
    setPhase('speaking')
    try {
      try {
        await ensureSessionRecorder()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'recorder_failed'
        pushLog(`Session recorder unavailable (${message}); proceeding without combined audio`)
      }
      const playback = await playAssistantResponse(OPENING, { label: 'intro' })
      pushLog(`Intro playback complete (${playback.durationMs} ms)`)
    } catch (err) {
      if (finishRequestedRef.current) {
        pushLog('Intro playback interrupted by finish request')
      } else {
        const message = err instanceof Error ? err.message : 'intro_failed'
        pushLog(`Intro playback failed (${message})`)
      }
    } finally {
      if (!finishRequestedRef.current) {
        setPhase('calibrating')
        runTurnLoop().catch(() => {})
      }
    }
  }, [ensureSessionRecorder, hasStarted, playAssistantResponse, pushLog, runTurnLoop, sessionId])

  const requestFinish = useCallback(async () => {
    if (finishRequestedRef.current) return
    finishRequestedRef.current = true
    setFinishRequested(true)
    pushLog('Finish requested by user')
    stopActivePlayback()
    abortAsk()
    abortTts()
    if (inTurnRef.current) {
      pushLog('Finishing after the current turn completes')
      return
    }
    setPhase('thinking')
    const ok = await finalizeNow()
    setPhase(ok ? 'finished' : 'idle')
  }, [abortAsk, abortTts, finalizeNow, pushLog, stopActivePlayback])

  useEffect(() => {
    if (!sessionId) return
    if (hasStarted) return
    startSession().catch(() => {})
  }, [hasStarted, sessionId, startSession])

  return (
    <main className="mt-8">
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-sm opacity-80">
            {phase === 'listening' && (
              <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.75)] animate-pulse" />
            )}
            {phase === 'calibrating' && (
              <span className="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.75)] animate-pulse" />
            )}
            {phase === 'speaking' && (
              <span className="w-3 h-3 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.75)] animate-pulse" />
            )}
            {phase === 'thinking' && (
              <span className="flex items-center gap-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <span
                    key={index}
                    className="w-2 h-2 rounded-full bg-sky-400 animate-bounce"
                    style={{ animationDelay: `${index * 0.15}s` }}
                  />
                ))}
              </span>
            )}
            <span>
              {!hasStarted
                ? 'Welcome'
                : finishRequested
                ? 'Wrapping up the session'
                : phase === 'calibrating'
                ? 'Getting ready to listen'
                : phase === 'speaking'
                ? 'Speaking'
                : phase === 'thinking'
                ? 'Thinking'
                : phase === 'listening'
                ? 'Listening'
                : phase === 'finished'
                ? 'Session complete'
                : 'Ready'}
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          {machineState !== 'doneSuccess' ? (
            <button
              onClick={requestFinish}
              disabled={!hasStarted || finishRequested || phase === 'initializing' || phase === 'finished'}
              className="text-sm bg-white/10 px-3 py-1 rounded-2xl disabled:opacity-50"
            >
              I'm finished
            </button>
          ) : (
            <button
              onClick={() => {
                stopActivePlayback()
                abortAsk()
                abortTts()
                try {
                  recorderRef.current?.cancel()
                } catch {}
                recorderRef.current = null
                recorderStartedRef.current = false
                sessionAudioUrlRef.current = null
                sessionAudioDurationRef.current = 0
                setHasStarted(false)
                setTurn(0)
                setFinishRequested(false)
                finishRequestedRef.current = false
                setPhase('initializing')
              }}
              className="text-sm bg-white/10 px-3 py-1 rounded-2xl"
            >
              Start Again
            </button>
          )}
        </div>

        <div className="w-full max-w-xl">
          <label className="text-xs opacity-70">On-screen Log (copy to share diagnostics):</label>
          <textarea value={debugLog.join('\n')} readOnly className="w-full h-56 bg-black/30 p-2 rounded" />
          <div className="mt-2 text-xs opacity-70">
            Need more? Visit <a className="underline" href="/diagnostics">Diagnostics</a>.
          </div>
        </div>
      </div>
    </main>
  )
}
