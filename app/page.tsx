"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInterviewMachine } from '@/lib/machine'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from '@/lib/audio-bridge'
import { createSessionRecorder, SessionRecorder } from '@/lib/session-recorder'
import { generateSessionTitle, SummarizableTurn } from '@/lib/session-title'

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

const INTRO_FALLBACK =
  'Welcome back. I remember everything you have trusted me with. Tell me one new detail you would like to explore now.'

const STATE_VISUALS: Record<
  'idle' | 'recording' | 'thinking' | 'playing' | 'readyToContinue' | 'doneSuccess',
  { icon: string; badge: string; title: string; description: string; gradient: string }
> = {
  idle: {
    icon: '✨',
    badge: 'Ready',
    title: 'Ready to begin',
    description: 'I’ll start the conversation and listen automatically. That glowing circle is all you need.',
    gradient: 'from-sky-400/40 via-blue-500/30 to-indigo-500/40',
  },
  recording: {
    icon: '🎤',
    badge: 'Listening',
    title: 'Listening',
    description: 'I am capturing every detail you say. Speak naturally and take your time.',
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
    description: 'Here is what I heard and how I would respond to keep you going.',
    gradient: 'from-amber-400/40 via-orange-500/40 to-amber-600/40',
  },
  readyToContinue: {
    icon: '✨',
    badge: 'Ready',
    title: 'Ready for more',
    description: 'I’m ready for whatever you want to share next—just start speaking.',
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
  const [disabledNext, setDisabledNext] = useState(false)
  const [finishRequested, setFinishRequested] = useState(false)
  const inTurnRef = useRef(false)
  const recorderRef = useRef<SessionRecorder | null>(null)
  const sessionAudioUrlRef = useRef<string | null>(null)
  const sessionAudioDurationRef = useRef<number>(0)
  const finishRequestedRef = useRef(false)
  const sessionInitRef = useRef(false)
  const lastAnnouncedSessionIdRef = useRef<string | null>(null)
  const conversationRef = useRef<SummarizableTurn[]>([])
  const autoAdvanceTimeoutRef = useRef<number | null>(null)

  const MAX_TURNS = Number.POSITIVE_INFINITY

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
    } finally {
      conversationRef.current = []
      finishRequestedRef.current = false
      setFinishRequested(false)
      setDisabledNext(false)
    }
  }, [pushLog, sessionId, toDone])

  const runTurnLoop = useCallback(async () => {
    if (!sessionId) return
    if (inTurnRef.current) return
    if (typeof window !== 'undefined' && autoAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(autoAdvanceTimeoutRef.current)
      autoAdvanceTimeoutRef.current = null
    }
    inTurnRef.current = true
    setDisabledNext(true)
    try {
      pushLog('Recording started')
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
      pushLog('Recording stopped → thinking')

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

      if (transcript) {
        conversationRef.current.push({ role: 'user', text: transcript })
      }
      if (reply) {
        conversationRef.current.push({ role: 'assistant', text: reply })
      }

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

      pushLog('Finished playing → ready')
      const reachedMax = nextTurn >= MAX_TURNS
      const shouldEnd =
        finishRequestedRef.current || endIntent || reachedMax || (transcript && endRegex.test(transcript))
      inTurnRef.current = false

      if (shouldEnd) {
        await finalizeNow()
      } else {
        setDisabledNext(false)
        if (!finishRequestedRef.current && typeof window !== 'undefined') {
          if (autoAdvanceTimeoutRef.current !== null) {
            window.clearTimeout(autoAdvanceTimeoutRef.current)
          }
          autoAdvanceTimeoutRef.current = window.setTimeout(() => {
            autoAdvanceTimeoutRef.current = null
            if (!finishRequestedRef.current) {
              runTurnLoop().catch(() => {})
            }
          }, 600)
        }
      }
    } catch (e) {
      pushLog('There was a problem saving or asking. Check /api/health and env keys.')
      inTurnRef.current = false
      setDisabledNext(false)
    }
  }, [MAX_TURNS, finalizeNow, playAssistantResponse, pushLog, sessionId, turn])

  const startSession = useCallback(async () => {
    if (hasStarted) return
    if (!sessionId) return
    conversationRef.current = []
    setFinishRequested(false)
    finishRequestedRef.current = false
    setHasStarted(true)
    setDisabledNext(true)
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
      setDisabledNext(false)
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
  }, [ensureSessionRecorder, hasStarted, playAssistantResponse, playWithSpeechSynthesis, pushLog, runTurnLoop, sessionId])

  const requestFinish = useCallback(async () => {
    if (finishRequestedRef.current) return
    setFinishRequested(true)
    pushLog('Finish requested by user')
    if (inTurnRef.current) {
      pushLog('Finishing after the current turn completes')
      return
    }
    await finalizeNow()
  }, [finalizeNow, pushLog])

  useEffect(() => {
    if (!sessionId) return
    if (hasStarted) return
    startSession().catch(() => {})
  }, [hasStarted, sessionId, startSession])

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

  const visual = STATE_VISUALS[machineState] ?? STATE_VISUALS.idle
  const isInitialState = !hasStarted && machineState === 'idle'
  const heroBadge = finishRequested ? 'Finishing' : visual.badge
  const heroIcon = finishRequested ? '📁' : visual.icon
  const heroTitle = finishRequested ? 'Wrapping up' : isInitialState ? 'Ready to begin' : visual.title
  const heroDescription = finishRequested
    ? 'Hold tight while I save your conversation and prepare your history.'
    : isInitialState
      ? 'I’ll start with a welcome and remember every word you share.'
      : disabledNext && machineState === 'thinking'
        ? 'Working through what you just said—this only takes a moment.'
        : disabledNext
          ? 'I’m listening closely. Take your time and keep talking whenever you’re ready.'
          : visual.description
  const heroGradient = finishRequested ? 'from-amber-400/40 via-amber-500/40 to-orange-500/40' : visual.gradient
  const statusMessage = !hasStarted
    ? 'Preparing to begin—I’ll speak first.'
    : finishRequested
      ? 'Wrapping up your session.'
      : machineState === 'doneSuccess'
        ? 'Session saved. Tap Start Again to record another memory.'
        : disabledNext
          ? machineState === 'thinking'
            ? 'Processing your story...'
            : 'Listening for you now. Take your time.'
          : 'I’m ready when you are—just start speaking.'

  return (
    <main className="mt-6 flex justify-center px-4 pb-16">
      <div className="flex w-full max-w-4xl flex-col items-center gap-12">
        <div className="flex w-full flex-col items-center gap-8">
          <div className="relative w-full max-w-[min(90vw,460px)]">
            <div className="relative aspect-square w-full">
              <div className="absolute inset-0 rounded-full bg-black/20 blur-3xl" aria-hidden="true" />
              <div
                className={`absolute inset-[8%] rounded-full bg-gradient-to-br ${heroGradient} animate-soft-pulse shadow-[0_0_80px_rgba(255,255,255,0.18)]`}
                aria-hidden="true"
              />
              <div className="absolute inset-[12%] rounded-full border border-white/15 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
              <div className="absolute inset-[18%] rounded-full border border-white/10 animate-slow-ripple" aria-hidden="true" />
              <div
                className="absolute inset-[18%] rounded-full border border-white/5 animate-slow-ripple"
                style={{ animationDelay: '1.2s' }}
                aria-hidden="true"
              />
              <div className="absolute inset-[18%] flex flex-col items-center justify-center px-8 text-center">
                <div className="text-5xl md:text-6xl" aria-hidden="true">
                  {heroIcon}
                </div>
                <div className="mt-4 text-[11px] uppercase tracking-[0.45em] text-white/50">{heroBadge}</div>
                <div className="mt-3 text-3xl font-semibold md:text-4xl">{heroTitle}</div>
                <p className="mt-4 text-sm text-white/70 md:text-base">{heroDescription}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <div className="text-sm text-white/70">{statusMessage}</div>
            {machineState !== 'doneSuccess' ? (
              <button
                onClick={onNext}
                disabled={disabledNext}
                className="rounded-full bg-white px-10 py-3 text-lg font-semibold text-black shadow-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 disabled:cursor-not-allowed disabled:bg-white/70 disabled:text-black/60"
              >
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
                  conversationRef.current = []
                  setHasStarted(false)
                  setTurn(0)
                  setFinishRequested(false)
                  finishRequestedRef.current = false
                }}
                className="rounded-full bg-white px-8 py-3 text-lg font-semibold text-black shadow-lg transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
              >
                Start Again
              </button>
            )}
            {machineState !== 'doneSuccess' && (
              <button
                onClick={requestFinish}
                disabled={!hasStarted || finishRequested}
                className="text-sm text-white/70 underline-offset-4 transition hover:text-white disabled:cursor-not-allowed disabled:text-white/40"
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
