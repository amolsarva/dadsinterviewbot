"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInterviewMachine } from '@/lib/machine'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from '@/lib/audio-bridge'
import { createSessionRecorder, SessionRecorder } from '@/lib/session-recorder'
import { generateSessionTitle, SummarizableTurn } from '@/lib/session-title'
import { detectCompletionIntent } from '@/lib/intents'

const SESSION_STORAGE_KEY = 'sessionId'
const HARD_TURN_LIMIT_MS = 90_000
const DEFAULT_BASELINE = 0.004
const MIN_BASELINE = 0.0004
const MAX_BASELINE = 0.05
const BASELINE_SPIKE_FACTOR = 2.8

const clampBaseline = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? NaN) || !value) {
    return DEFAULT_BASELINE
  }
  const clamped = Math.min(Math.max(value, MIN_BASELINE), MAX_BASELINE)
  return clamped
}

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

const INTRO_FALLBACK =
  'Welcome back. I remember everything you have trusted me with. Tell me one new detail you would like to explore now.'

const STATE_VISUALS: Record<
  'idle' | 'calibrating' | 'recording' | 'thinking' | 'playing' | 'readyToContinue' | 'doneSuccess',
  { icon: string; badge: string; title: string; description: string; gradient: string }
> = {
  idle: {
    icon: '✨',
    badge: 'Ready',
    title: 'Ready to begin',
    description: 'I’ll start the conversation for you—just settle in and listen.',
    gradient: 'from-sky-400/40 via-blue-500/30 to-indigo-500/40',
  },
  calibrating: {
    icon: '🎚️',
    badge: 'Preparing',
    title: 'Getting ready to listen',
    description: 'Give me a moment to measure the room noise before I start recording.',
    gradient: 'from-cyan-400/40 via-sky-400/40 to-indigo-400/40',
  },
  recording: {
    icon: '🎤',
    badge: 'Listening',
    title: 'Listening',
    description: 'I’m capturing every detail you say. Speak naturally and tap the ring when you’d like me to stop listening.',
    gradient: 'from-emerald-400/40 via-lime-300/40 to-emerald-500/40',
  },
  thinking: {
    icon: '🤔',
    badge: 'Thinking',
    title: 'Thinking',
    description: 'Give me a brief moment while I make sense of what you shared.',
    gradient: 'from-fuchsia-400/40 via-purple-500/40 to-indigo-600/40',
  },
  playing: {
    icon: '💬',
    badge: 'Speaking',
    title: 'Speaking',
    description: 'Sharing what I heard and how we can keep going.',
    gradient: 'from-amber-400/40 via-orange-500/40 to-amber-600/40',
  },
  readyToContinue: {
    icon: '✨',
    badge: 'Ready',
    title: 'Ready for more',
    description: 'Just start speaking whenever you’re ready for the next part.',
    gradient: 'from-sky-400/40 via-cyan-400/40 to-blue-500/40',
  },
  doneSuccess: {
    icon: '✅',
    badge: 'Complete',
    title: 'Session complete',
    description: 'Review your links or start another memory when you feel inspired.',
    gradient: 'from-slate-400/40 via-slate-500/40 to-slate-600/40',
  },
}

type AssistantPlayback = {
  base64: string | null
  mime: string
  durationMs: number
}

export default function Home() {
  const machineState = useInterviewMachine((state) => state.state)
  const debugLog = useInterviewMachine((state) => state.debugLog)
  const pushLog = useInterviewMachine((state) => state.pushLog)
  const toDone = useInterviewMachine((state) => state.toDone)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turn, setTurn] = useState<number>(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [finishRequested, setFinishRequested] = useState(false)
  const [manualStopRequested, setManualStopRequested] = useState(false)
  const inTurnRef = useRef(false)
  const manualStopRef = useRef(false)
  const recorderRef = useRef<SessionRecorder | null>(null)
  const sessionAudioUrlRef = useRef<string | null>(null)
  const sessionAudioDurationRef = useRef<number>(0)
  const baselineRef = useRef<number | null>(null)
  const finishRequestedRef = useRef(false)
  const sessionInitRef = useRef(false)
  const lastAnnouncedSessionIdRef = useRef<string | null>(null)
  const conversationRef = useRef<SummarizableTurn[]>([])
  const autoAdvanceTimeoutRef = useRef<number | null>(null)

  const MAX_TURNS = Number.POSITIVE_INFINITY

  const updateMachineState = useCallback(
    (
      next:
        | 'idle'
        | 'calibrating'
        | 'recording'
        | 'thinking'
        | 'playing'
        | 'readyToContinue'
        | 'doneSuccess',
    ) => {
      useInterviewMachine.setState((prev) => (prev.state === next ? prev : { ...prev, state: next }))
    },
    [],
  )

  useEffect(() => {
    finishRequestedRef.current = finishRequested
  }, [finishRequested])

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

  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.cancel()
      } catch {}
      recorderRef.current = null
      if (typeof window !== 'undefined' && autoAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(autoAdvanceTimeoutRef.current)
      }
      autoAdvanceTimeoutRef.current = null
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
      pushLog('Assistant reply ready → playing')
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, speed: 1.22 }),
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
            pushLog('Recorder playback failed, falling back to direct audio')
            durationMs = await playWithAudioElement(data.audioBase64, mime)
          }
        } else {
          durationMs = await playWithAudioElement(data.audioBase64, mime)
        }
        return { base64: data.audioBase64, mime, durationMs }
      } catch (err) {
        pushLog('TTS unavailable, using speech synthesis fallback')
        const durationMs = await playWithSpeechSynthesis(text)
        return { base64: null, mime: 'audio/mpeg', durationMs }
      }
    },
    [playWithAudioElement, playWithSpeechSynthesis, pushLog],
  )

  const finalizeNow = useCallback(async () => {
    if (!sessionId) return
    setManualStopRequested(false)
    manualStopRef.current = false
    updateMachineState('thinking')
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
              pushLog('Failed to store session audio')
            }
          }
        } catch (err) {
          pushLog('Session audio capture failed')
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
        const summaryTitle =
          generateSessionTitle(conversationRef.current, {
            fallback: `Session on ${new Date(stamp).toLocaleDateString()}`,
          }) || null
        demo.unshift({ id: sessionId, created_at: stamp, title: summaryTitle })
        localStorage.setItem('demoHistory', JSON.stringify(demo.slice(0, 50)))
      } catch {}

      toDone()
    } catch {
      pushLog('Finalize failed')
      updateMachineState('readyToContinue')
    } finally {
      conversationRef.current = []
      finishRequestedRef.current = false
      setFinishRequested(false)
    }
  }, [pushLog, sessionId, toDone, updateMachineState])

  const requestManualStop = useCallback(() => {
    if (!inTurnRef.current) return
    if (manualStopRef.current) return
    manualStopRef.current = true
    setManualStopRequested(true)
    pushLog('Manual stop requested')
  }, [manualStopRef, pushLog])

  const runTurnLoop = useCallback(async () => {
    if (!sessionId) return
    if (inTurnRef.current) return
    if (typeof window !== 'undefined' && autoAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(autoAdvanceTimeoutRef.current)
      autoAdvanceTimeoutRef.current = null
    }
    inTurnRef.current = true
    manualStopRef.current = false
    setManualStopRequested(false)
    updateMachineState('calibrating')
    pushLog('Calibrating microphone baseline')
    try {
      let b64 = ''
      let recDuration = 0
      let baselineToUse = baselineRef.current ?? DEFAULT_BASELINE
      const calibrateDuration = baselineRef.current ? 0.6 : 0.9
      try {
        const measured = clampBaseline(await calibrateRMS(calibrateDuration))
        const previous = baselineRef.current
        if (previous && measured > previous * BASELINE_SPIKE_FACTOR) {
          pushLog(
            `Baseline spike detected (${measured.toFixed(4)}). Reusing previous value ${previous.toFixed(4)}.`,
          )
          baselineToUse = previous
        } else {
          baselineToUse = measured
          baselineRef.current = measured
          pushLog(`Baseline ready: ${measured.toFixed(4)}`)
        }
      } catch (err) {
        const previous = baselineRef.current
        if (previous) {
          baselineToUse = previous
          pushLog(`Baseline calibration failed. Reusing previous value ${previous.toFixed(4)}.`)
        } else {
          baselineToUse = DEFAULT_BASELINE
          pushLog(`Baseline calibration failed. Using default value ${baselineToUse.toFixed(4)}.`)
        }
      }

      updateMachineState('recording')
      pushLog(`Recording started (baseline ${baselineToUse.toFixed(4)})`)
      try {
        const hardStopAt = Date.now() + HARD_TURN_LIMIT_MS
        const rec = await recordUntilSilence({
          baseline: baselineToUse,
          minDurationMs: 800,
          maxDurationMs: HARD_TURN_LIMIT_MS,
          silenceMs: 900,
          graceMs: 300,
          startRatio: 2.4,
          stopRatio: 1.5,
          shouldForceStop: () => {
            if (finishRequestedRef.current) return true
            if (manualStopRef.current) return true
            return Date.now() >= hardStopAt
          },
        })
        b64 = await blobToBase64(rec.blob)
        recDuration = rec.durationMs || 0
      } catch {
        const silent = new Blob([new Uint8Array(1)], { type: 'audio/webm' })
        b64 = await blobToBase64(silent)
        recDuration = 500
      }
      if (recDuration < 100) {
        pushLog(`Warning: captured very short audio (${Math.round(recDuration)}ms).`)
      }
      manualStopRef.current = false
      setManualStopRequested(false)
      pushLog('Recording stopped → thinking')
      updateMachineState('thinking')

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
      if (transcript) {
        conversationRef.current.push({ role: 'user', text: transcript })
      }
      if (reply) {
        conversationRef.current.push({ role: 'assistant', text: reply })
      }

      const completionIntent = detectCompletionIntent(transcript)
      if (completionIntent.shouldStop) {
        const match = completionIntent.matchedPhrases.join(', ')
        pushLog(
          match.length
            ? `Completion intent detected (${completionIntent.confidence}): ${match}`
            : `Completion intent detected (${completionIntent.confidence})`,
        )
      }

      let assistantPlayback: AssistantPlayback = { base64: null, mime: 'audio/mpeg', durationMs: 0 }
      updateMachineState('playing')
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

      pushLog('Finished playing → ready')
      const reachedMax = nextTurn >= MAX_TURNS
      const shouldEnd =
        finishRequestedRef.current || endIntent || reachedMax || completionIntent.shouldStop
      inTurnRef.current = false

      if (shouldEnd) {
        if (!finishRequestedRef.current) {
          finishRequestedRef.current = true
          setFinishRequested(true)
        }
        await finalizeNow()
      } else {
        updateMachineState('readyToContinue')
        if (!finishRequestedRef.current && typeof window !== 'undefined') {
          if (autoAdvanceTimeoutRef.current !== null) {
            window.clearTimeout(autoAdvanceTimeoutRef.current)
          }
          autoAdvanceTimeoutRef.current = window.setTimeout(() => {
            autoAdvanceTimeoutRef.current = null
            if (!finishRequestedRef.current) {
              runTurnLoop().catch(() => {})
            }
          }, 700)
        }
      }
    } catch (e) {
      pushLog('There was a problem saving or asking. Check /api/health and env keys.')
      inTurnRef.current = false
      manualStopRef.current = false
      setManualStopRequested(false)
      updateMachineState('readyToContinue')
    }
  }, [
    MAX_TURNS,
    finalizeNow,
    manualStopRef,
    playAssistantResponse,
    pushLog,
    sessionId,
    turn,
    updateMachineState,
  ])

  const startSession = useCallback(async () => {
    if (hasStarted) return
    if (!sessionId) return
    conversationRef.current = []
    setFinishRequested(false)
    finishRequestedRef.current = false
    setManualStopRequested(false)
    manualStopRef.current = false
    setHasStarted(true)
    let introMessage = ''
    try {
      try {
        await ensureSessionRecorder()
      } catch {
        pushLog('Session recorder unavailable; proceeding without combined audio')
      }

      try {
        const res = await fetch(`/api/session/${sessionId}/intro`, { method: 'POST' })
        const json = await res.json().catch(() => null)
        if (res.ok && typeof json?.message === 'string' && json.message.trim().length) {
          introMessage = json.message.trim()
        }
      } catch (err) {
        pushLog('Intro prompt unavailable; using fallback greeting')
      }

      if (!introMessage) {
        introMessage = INTRO_FALLBACK
      }

      conversationRef.current.push({ role: 'assistant', text: introMessage })

      try {
        await fetch(`/api/session/${sessionId}/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', text: introMessage }),
        })
      } catch {}

      pushLog('Intro message ready → playing')
      updateMachineState('playing')
      try {
        await playAssistantResponse(introMessage)
      } catch {
        await playWithSpeechSynthesis(introMessage)
      }
    } catch {
      try {
        await playWithSpeechSynthesis(INTRO_FALLBACK)
      } catch {}
    } finally {
      if (!finishRequestedRef.current) {
        updateMachineState('readyToContinue')
      }
      if (!finishRequestedRef.current && typeof window !== 'undefined') {
        if (autoAdvanceTimeoutRef.current !== null) {
          window.clearTimeout(autoAdvanceTimeoutRef.current)
        }
        autoAdvanceTimeoutRef.current = window.setTimeout(() => {
          autoAdvanceTimeoutRef.current = null
          if (!finishRequestedRef.current) {
            runTurnLoop().catch(() => {})
          }
        }, 700)
      }
    }
  }, [
    ensureSessionRecorder,
    hasStarted,
    manualStopRef,
    playAssistantResponse,
    playWithSpeechSynthesis,
    pushLog,
    runTurnLoop,
    sessionId,
    updateMachineState,
  ])

  const requestFinish = useCallback(async () => {
    if (finishRequestedRef.current) return
    setFinishRequested(true)
    pushLog('Finish requested by user')
    if (inTurnRef.current) {
      pushLog('Finishing after the current turn completes')
      requestManualStop()
      return
    }
    await finalizeNow()
  }, [finalizeNow, pushLog, requestManualStop])

  useEffect(() => {
    if (!sessionId) return
    if (hasStarted) return
    startSession().catch(() => {})
  }, [hasStarted, sessionId, startSession])

  const handleHeroPress = useCallback(() => {
    if (machineState === 'recording') {
      requestManualStop()
    }
  }, [machineState, requestManualStop])

  const visual = STATE_VISUALS[machineState] ?? STATE_VISUALS.idle
  const isInitialState = !hasStarted && machineState === 'idle'
  const heroBadge = finishRequested ? 'Finishing' : manualStopRequested ? 'Stopping' : visual.badge
  const heroIcon = finishRequested ? '📁' : manualStopRequested ? '⏹️' : visual.icon
  const heroTitle = finishRequested
    ? 'Wrapping up'
    : manualStopRequested
      ? 'Stopping the recording'
      : isInitialState
        ? 'Ready to begin'
        : visual.title
  const heroDescription = (() => {
    if (finishRequested) {
      return 'Hold tight while I save your conversation and prepare your history.'
    }
    if (manualStopRequested) {
      return 'Closing this turn—give me a moment to capture what you said.'
    }
    if (isInitialState) {
      return 'I’ll start with a welcome and remember every word you share.'
    }
    switch (machineState) {
      case 'calibrating':
        return 'Measuring the room noise so I can tell when you start speaking.'
      case 'recording':
        return 'Speak naturally. Tap the glowing ring whenever you want me to stop listening.'
      case 'thinking':
        return 'Working through what you just said—this only takes a moment.'
      case 'playing':
        return 'Sharing what I heard and how we can keep going.'
      case 'readyToContinue':
        return 'I’m ready whenever you are—just start speaking.'
      default:
        return visual.description
    }
  })()
  const heroGradient = finishRequested
    ? 'from-amber-400/40 via-amber-500/40 to-orange-500/40'
    : manualStopRequested
      ? 'from-rose-400/40 via-rose-500/40 to-red-500/40'
      : visual.gradient
  const heroAriaLabel = finishRequested
    ? 'Wrapping up the session'
    : manualStopRequested
      ? 'Stopping the recording'
      : machineState === 'recording'
        ? 'Listening. Tap to finish your turn.'
        : machineState === 'calibrating'
          ? 'Calibrating the microphone baseline'
          : 'Session status indicator'
  const statusMessage = (() => {
    if (!hasStarted) {
      return 'Let me welcome you first—I’ll begin automatically.'
    }
    if (finishRequested) {
      return 'Wrapping up your session.'
    }
    if (manualStopRequested) {
      return 'Stopping the recording now.'
    }
    switch (machineState) {
      case 'calibrating':
        return 'Measuring the room noise before we begin.'
      case 'recording':
        return 'Listening now. Take your time and tap the ring when you’re finished.'
      case 'thinking':
        return 'Processing what you shared…'
      case 'playing':
        return 'Sharing what I heard back to you.'
      case 'readyToContinue':
        return 'Ready when you are—just start speaking.'
      case 'doneSuccess':
        return 'Session saved. Tap Start Again to record another memory.'
      default:
        return 'Preparing to begin—I’ll speak first.'
    }
  })()

  return (
    <main className="mt-6 flex justify-center px-4 pb-16">
      <div className="flex w-full max-w-4xl flex-col items-center gap-12">
        <div className="flex w-full flex-col items-center gap-8">
          <div className="relative w-full max-w-[min(90vw,460px)]">
            <button
              type="button"
              onClick={handleHeroPress}
              className="group relative aspect-square w-full overflow-hidden rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60"
              aria-label={heroAriaLabel}
            >
              <span className="absolute inset-0 rounded-full bg-black/20 blur-3xl" aria-hidden="true" />
              <span
                className={`absolute inset-[8%] rounded-full bg-gradient-to-br ${heroGradient} animate-soft-pulse shadow-[0_0_80px_rgba(255,255,255,0.18)]`}
                aria-hidden="true"
              />
              <span className="absolute inset-[12%] rounded-full border border-white/15 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
              <span className="absolute inset-[18%] rounded-full border border-white/10 animate-slow-ripple" aria-hidden="true" />
              <span
                className="absolute inset-[18%] rounded-full border border-white/5 animate-slow-ripple"
                style={{ animationDelay: '1.2s' }}
                aria-hidden="true"
              />
              <span className="absolute inset-[18%] flex flex-col items-center justify-center px-8 text-center">
                <span className="text-5xl md:text-6xl" aria-hidden="true">
                  {heroIcon}
                </span>
                <span className="mt-4 text-[11px] uppercase tracking-[0.45em] text-white/50">{heroBadge}</span>
                <span className="mt-3 text-3xl font-semibold md:text-4xl">{heroTitle}</span>
                <span className="mt-4 text-sm text-white/70 md:text-base">{heroDescription}</span>
              </span>
            </button>
          </div>

          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-sm text-white/70">{statusMessage}</div>
            {machineState === 'doneSuccess' ? (
              <button
                onClick={() => {
                  try {
                    recorderRef.current?.cancel()
                  } catch {}
                  recorderRef.current = null
                  sessionAudioUrlRef.current = null
                  sessionAudioDurationRef.current = 0
                  conversationRef.current = []
                  setHasStarted(false)
                  setTurn(0)
                  setFinishRequested(false)
                  finishRequestedRef.current = false
                  manualStopRef.current = false
                  setManualStopRequested(false)
                  updateMachineState('idle')
                }}
                className="rounded-full bg-white px-8 py-3 text-lg font-semibold text-black shadow-lg transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
              >
                Start Again
              </button>
            ) : null}
            {machineState !== 'doneSuccess' && (
              <button
                onClick={requestFinish}
                disabled={!hasStarted || finishRequested}
                className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-medium text-white/80 transition hover:border-white/40 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40"
              >
                I’m finished
              </button>
            )}
          </div>
        </div>

        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.4em] text-white/40">
            <span>Diagnostics log</span>
            <a className="text-xs font-medium uppercase tracking-[0.2em] text-white/50 underline hover:text-white/80" href="/diagnostics">
              Open
            </a>
          </div>
          <textarea
            value={debugLog.join('\n')}
            readOnly
            className="mt-2 h-28 w-full resize-none rounded border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-white/70"
          />
          <div className="mt-1 text-[11px] text-white/40">
            Need more detail?{' '}
            <a className="underline hover:text-white/80" href="/diagnostics">
              Visit Diagnostics
            </a>
            .
          </div>
        </div>
      </div>
    </main>
  )
}
