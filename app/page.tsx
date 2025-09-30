"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useInterviewMachine } from '@/lib/machine'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from '@/lib/audio-bridge'
import { createSessionRecorder, SessionRecorder } from '@/lib/session-recorder'
import { generateSessionTitle, SummarizableTurn } from '@/lib/session-title'
import { detectCompletionIntent } from '@/lib/intents'
import {
  ACTIVE_USER_HANDLE_STORAGE_KEY,
  DEFAULT_NOTIFY_EMAIL,
  DEMO_HISTORY_BASE_KEY,
  EMAIL_ENABLED_STORAGE_BASE_KEY,
  EMAIL_STORAGE_BASE_KEY,
  SESSION_STORAGE_BASE_KEY,
  buildScopedPath,
  deriveUserScopeKey,
  normalizeHandle,
  scopedStorageKey,
} from '@/lib/user-scope'

const HARD_TURN_LIMIT_MS = 90_000
const DEFAULT_BASELINE = 0.004
const MIN_BASELINE = 0.0004
const MAX_BASELINE = 0.05
const BASELINE_SPIKE_FACTOR = 2.8
const INTRO_MIN_PREP_MS = 700

const clampBaseline = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? NaN) || !value) {
    return DEFAULT_BASELINE
  }
  const clamped = Math.min(Math.max(value, MIN_BASELINE), MAX_BASELINE)
  return clamped
}

const truncateForLog = (input: string | null | undefined, max: number = 200) => {
  if (!input) return ''
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1))}…`
}

const formatPreviewList = (items: string[] | undefined, max: number = 3) => {
  if (!items || !items.length) return ''
  return items
    .filter((item) => typeof item === 'string' && item.trim().length)
    .slice(0, max)
    .map((item) => truncateForLog(item, 80))
    .join(' | ')
}

const DIAGNOSTIC_TRANSCRIPT_STORAGE_KEY = 'diagnostics:lastTranscript'
const DIAGNOSTIC_PROVIDER_ERROR_STORAGE_KEY = 'diagnostics:lastProviderError'

type DiagnosticTranscriptPayload = {
  text: string
  turn: number
  at: string
  isEmpty: boolean
  reason?: string
  meta?: {
    started: boolean
    manualStop: boolean
    stopReason: string
  }
  provider?: string | null
}

type DiagnosticProviderErrorPayload = {
  status: number | null
  message: string
  reason?: string
  snippet?: string
  at: string
  resolved?: boolean
  resolvedAt?: string
}

export default function RootPage() {
  return <Home key="__default__" />
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

type IntroDebugPayload = {
  hasPriorSessions?: boolean
  sessionCount?: number
  rememberedTitles?: string[]
  rememberedDetails?: string[]
  askedQuestionsPreview?: string[]
  primerPreview?: string
  fallbackQuestion?: string
}

type IntroResponse = {
  ok?: boolean
  message?: string
  fallback?: boolean
  reason?: string
  debug?: IntroDebugPayload | null
}

type AskDebugMemory = {
  hasPriorSessions?: boolean
  hasCurrentConversation?: boolean
  highlightDetail?: string | null
  recentConversationPreview?: string
  historyPreview?: string
  questionPreview?: string
  primerPreview?: string
  askedQuestionsPreview?: string[]
}

type AskDebugPayload = {
  sessionId?: string | null
  turn?: number | null
  provider?: string
  usedFallback?: boolean
  reason?: string
  providerResponseSnippet?: string
  providerStatus?: number | null
  providerError?: string | null
  memory?: AskDebugMemory
}

type AskResponse = {
  ok?: boolean
  provider?: string
  reply?: string
  transcript?: string
  end_intent?: boolean
  debug?: AskDebugPayload | null
}

type ScopedSessionState = {
  inMemorySessionId: string | null
  sessionStartPromise: Promise<NetworkSessionResult> | null
}

const scopedSessionStates = new Map<string, ScopedSessionState>()

function getScopedSessionState(handle?: string | null) {
  const key = deriveUserScopeKey(handle)
  let state = scopedSessionStates.get(key)
  if (!state) {
    state = { inMemorySessionId: null, sessionStartPromise: null }
    scopedSessionStates.set(key, state)
  }
  return { key, state }
}

const createLocalSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

const readStoredSessionId = (handle?: string | null) => {
  if (typeof window === 'undefined') return null
  try {
    const key = scopedStorageKey(SESSION_STORAGE_BASE_KEY, handle)
    const stored = window.sessionStorage.getItem(key)
    return stored && typeof stored === 'string' ? stored : null
  } catch {
    return null
  }
}

const persistSessionId = (id: string, handle?: string | null) => {
  if (typeof window === 'undefined') return
  try {
    const key = scopedStorageKey(SESSION_STORAGE_BASE_KEY, handle)
    window.sessionStorage.setItem(key, id)
  } catch {}
}

const readEmailPreferences = (handle?: string | null) => {
  if (typeof window === 'undefined') {
    return { email: DEFAULT_NOTIFY_EMAIL, emailsEnabled: true }
  }
  try {
    const emailKey = scopedStorageKey(EMAIL_STORAGE_BASE_KEY, handle)
    const email = window.localStorage.getItem(emailKey) || DEFAULT_NOTIFY_EMAIL
    const enabledKey = scopedStorageKey(EMAIL_ENABLED_STORAGE_BASE_KEY, handle)
    const rawEnabled = window.localStorage.getItem(enabledKey)
    const emailsEnabled = rawEnabled === null ? true : rawEnabled !== 'false'
    return { email, emailsEnabled }
  } catch {
    return { email: DEFAULT_NOTIFY_EMAIL, emailsEnabled: true }
  }
}

const requestNewSessionId = async (handle?: string | null): Promise<NetworkSessionResult> => {
  const { state } = getScopedSessionState(handle)

  if (typeof window === 'undefined') {
    const fallbackId = createLocalSessionId()
    state.inMemorySessionId = fallbackId
    return { id: fallbackId, source: 'fallback' as const }
  }

  try {
    const { email, emailsEnabled } = readEmailPreferences(handle)
    const res = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, emailsEnabled, userHandle: normalizeHandle(handle) ?? null }),
    })
    const data = await res.json().catch(() => ({}))
    const id = typeof data?.id === 'string' && data.id ? data.id : createLocalSessionId()
    const source: NetworkSessionResult['source'] =
      typeof data?.id === 'string' && data.id ? 'network' : 'fallback'
    state.inMemorySessionId = id
    persistSessionId(id, handle)
    return { id, source }
  } catch {
    let id = readStoredSessionId(handle)
    if (!id) {
      id = createLocalSessionId()
    }
    state.inMemorySessionId = id
    persistSessionId(id, handle)
    return { id, source: 'fallback' as const }
  }
}

const ensureSessionIdOnce = async (handle?: string | null): Promise<SessionInitResult> => {
  const { state } = getScopedSessionState(handle)

  if (state.inMemorySessionId) {
    return { id: state.inMemorySessionId, source: 'memory' }
  }

  const stored = readStoredSessionId(handle)
  if (stored) {
    state.inMemorySessionId = stored
    return { id: stored, source: 'storage' }
  }

  if (!state.sessionStartPromise) {
    state.sessionStartPromise = requestNewSessionId(handle).finally(() => {
      const current = getScopedSessionState(handle).state
      current.sessionStartPromise = null
    })
  }

  const result = await state.sessionStartPromise
  return result
}

const INTRO_FALLBACK =
  'Welcome back. I remember everything you have trusted me with. Tell me one new detail you would like to explore now.'

const STATE_VISUALS: Record<
  | 'idle'
  | 'calibrating'
  | 'recording'
  | 'thinking'
  | 'speakingPrep'
  | 'playing'
  | 'readyToContinue'
  | 'doneSuccess',
  {
    icon: string
    badge: string
    title: string
    description: string
    tone: { accent: string; gradient: string }
  }
> = {
  idle: {
    icon: '✨',
    badge: 'Ready',
    title: 'Ready to begin',
    description: 'I’ll start the conversation for you—just settle in and listen.',
    tone: {
      accent: '#1b8d55',
      gradient: 'linear-gradient(135deg, rgba(255, 186, 102, 0.3), rgba(255, 247, 237, 0.88), rgba(121, 205, 159, 0.32))',
    },
  },
  calibrating: {
    icon: '🎚️',
    badge: 'Preparing',
    title: 'Getting ready to listen',
    description: 'Give me a moment to measure the room noise before I start recording.',
    tone: {
      accent: '#0ea5e9',
      gradient: 'linear-gradient(135deg, rgba(125, 211, 161, 0.28), rgba(14, 165, 233, 0.24))',
    },
  },
  recording: {
    icon: '🎤',
    badge: 'Listening',
    title: 'Listening',
    description: 'I’m capturing every detail you say. Speak naturally and tap the ring when you’d like me to stop listening.',
    tone: {
      accent: '#f97316',
      gradient: 'linear-gradient(135deg, rgba(255, 186, 102, 0.3), rgba(255, 247, 237, 0.82), rgba(19, 136, 8, 0.22))',
    },
  },
  thinking: {
    icon: '🤔',
    badge: 'Thinking',
    title: 'Thinking',
    description: 'Give me a brief moment while I make sense of what you shared.',
    tone: {
      accent: '#9333ea',
      gradient: 'linear-gradient(135deg, rgba(244, 187, 255, 0.28), rgba(190, 227, 248, 0.26))',
    },
  },
  speakingPrep: {
    icon: '🔄',
    badge: 'Warming up',
    title: 'Preparing to speak',
    description: 'Spinning up my voice so I can respond clearly.',
    tone: {
      accent: '#f97316',
      gradient: 'linear-gradient(135deg, rgba(255, 207, 134, 0.34), rgba(255, 247, 237, 0.86))',
    },
  },
  playing: {
    icon: '💬',
    badge: 'Speaking',
    title: 'Speaking',
    description: 'Sharing what I heard and how we can keep going.',
    tone: {
      accent: '#f97316',
      gradient: 'linear-gradient(135deg, rgba(255, 186, 102, 0.32), rgba(255, 247, 237, 0.86))',
    },
  },
  readyToContinue: {
    icon: '✨',
    badge: 'Ready',
    title: 'Ready for more',
    description: 'Just start speaking whenever you’re ready for the next part.',
    tone: {
      accent: '#1b8d55',
      gradient: 'linear-gradient(135deg, rgba(121, 205, 159, 0.3), rgba(255, 247, 237, 0.8))',
    },
  },
  doneSuccess: {
    icon: '✅',
    badge: 'Complete',
    title: 'Session complete',
    description: 'Review your links or start another memory when you feel inspired.',
    tone: {
      accent: '#0f7c4b',
      gradient: 'linear-gradient(135deg, rgba(121, 205, 159, 0.26), rgba(255, 247, 237, 0.82))',
    },
  },
}

type AssistantPlayback = {
  base64: string | null
  mime: string
  durationMs: number
}

export function Home({ userHandle }: { userHandle?: string }) {
  const normalizedHandle = normalizeHandle(userHandle)
  const displayHandle = userHandle?.trim() || null
  const machineState = useInterviewMachine((state) => state.state)
  const debugLog = useInterviewMachine((state) => state.debugLog)
  const pushLog = useInterviewMachine((state) => state.pushLog)
  const toDone = useInterviewMachine((state) => state.toDone)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turn, setTurn] = useState<number>(0)
  const [hasStarted, setHasStarted] = useState(false)
  const [finishRequested, setFinishRequested] = useState(false)
  const [manualStopRequested, setManualStopRequested] = useState(false)
  const [providerError, setProviderError] = useState<DiagnosticProviderErrorPayload | null>(null)
  const inTurnRef = useRef(false)
  const manualStopRef = useRef(false)
  const recorderRef = useRef<SessionRecorder | null>(null)
  const sessionAudioUrlRef = useRef<string | null>(null)
  const sessionAudioDurationRef = useRef<number>(0)
  const baselineRef = useRef<number | null>(null)
  const finishRequestedRef = useRef(false)
  const sessionInitRef = useRef(false)
  const lastAnnouncedSessionIdRef = useRef<string | null>(null)
  const diagnosticsHref = buildScopedPath('/diagnostics', normalizedHandle)
  const lastLoggedHandleRef = useRef<string | null>(null)
  const conversationRef = useRef<SummarizableTurn[]>([])
  const autoAdvanceTimeoutRef = useRef<number | null>(null)
  const providerErrorRef = useRef<DiagnosticProviderErrorPayload | null>(null)

  const easternTimeFormatter = useMemo(
    () =>
      typeof Intl !== 'undefined'
        ? new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : null,
    [],
  )

  const MAX_TURNS = Number.POSITIVE_INFINITY

  const updateMachineState = useCallback(
    (
      next:
        | 'idle'
        | 'calibrating'
        | 'recording'
        | 'thinking'
        | 'speakingPrep'
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
    if (typeof window === 'undefined') return
    if (normalizedHandle) {
      window.localStorage.setItem(ACTIVE_USER_HANDLE_STORAGE_KEY, normalizedHandle)
    } else {
      window.localStorage.removeItem(ACTIVE_USER_HANDLE_STORAGE_KEY)
    }
  }, [normalizedHandle])

  useEffect(() => {
    if (!normalizedHandle) {
      lastLoggedHandleRef.current = null
      return
    }
    if (lastLoggedHandleRef.current === normalizedHandle) return
    lastLoggedHandleRef.current = normalizedHandle
    pushLog(`Viewing account: /u/${normalizedHandle}`)
  }, [normalizedHandle, pushLog])

  useEffect(() => {
    if (sessionInitRef.current) return
    sessionInitRef.current = true
    if (typeof window === 'undefined') return

    let cancelled = false

    try {
      const raw = window.localStorage.getItem(DIAGNOSTIC_PROVIDER_ERROR_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as DiagnosticProviderErrorPayload
        if (parsed && typeof parsed === 'object') {
          providerErrorRef.current = parsed
          if (parsed.resolved !== true) {
            setProviderError(parsed)
          }
        }
      }
    } catch {}

    ensureSessionIdOnce(normalizedHandle)
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
        const { state } = getScopedSessionState(normalizedHandle)
        state.inMemorySessionId = fallbackId
        persistSessionId(fallbackId, normalizedHandle)
        setSessionId(fallbackId)
        if (lastAnnouncedSessionIdRef.current !== fallbackId) {
          lastAnnouncedSessionIdRef.current = fallbackId
          pushLog('Session started (fallback): ' + fallbackId)
        }
      })

    return () => {
      cancelled = true
    }
  }, [normalizedHandle, pushLog])

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

  const playWithAudioElement = useCallback(
    async (
      base64: string,
      mime: string,
      options?: {
        onStart?: () => void
      },
    ) => {
      if (typeof window === 'undefined') return 0
      return await new Promise<number>((resolve) => {
        try {
          const src = `data:${mime};base64,${base64}`
          const audio = new Audio(src)
          const triggerStart = () => {
            if (!options?.onStart) return
            try {
              options.onStart()
            } catch {}
          }
          let started = false
          const ensureStarted = () => {
            if (started) return
            started = true
            triggerStart()
          }
          audio.onended = () => {
            resolve(Math.round((audio.duration || 0) * 1000))
          }
          audio.onerror = () => resolve(0)
          audio.onplay = ensureStarted
          audio.onplaying = ensureStarted
          const playPromise = audio.play()
          if (playPromise && typeof playPromise.then === 'function') {
            playPromise
              .then(() => {
                ensureStarted()
              })
              .catch(() => {
                resolve(0)
              })
          } else {
            ensureStarted()
          }
        } catch {
          resolve(0)
        }
      })
    },
    [],
  )

  const playWithSpeechSynthesis = useCallback(
    async (
      text: string,
      options?: {
        onStart?: () => void
      },
    ) => {
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
          const triggerStart = () => {
            if (!options?.onStart) return
            try {
              options.onStart()
            } catch {}
          }
          let started = false
          const ensureStarted = () => {
            if (started) return
            started = true
            triggerStart()
          }
          utterance.onstart = ensureStarted
          utterance.onend = () => resolve(0)
          utterance.onerror = () => resolve(0)
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(utterance)
          ensureStarted()
        } catch {
          resolve(0)
        }
      })
    },
    [],
  )

  const playAssistantResponse = useCallback(
    async (
      text: string,
      options?: {
        onPlaybackStart?: () => void
      },
    ): Promise<AssistantPlayback> => {
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
            if (options?.onPlaybackStart) {
              try {
                options.onPlaybackStart()
              } catch {}
            }
            const playback = await recorder.playAssistantBase64(data.audioBase64, mime)
            durationMs = playback?.durationMs ?? 0
          } catch (err) {
            pushLog('Recorder playback failed, falling back to direct audio')
            durationMs = await playWithAudioElement(data.audioBase64, mime, {
              onStart: options?.onPlaybackStart,
            })
          }
        } else {
          durationMs = await playWithAudioElement(data.audioBase64, mime, {
            onStart: options?.onPlaybackStart,
          })
        }
        return { base64: data.audioBase64, mime, durationMs }
      } catch (err) {
        pushLog('TTS unavailable, using speech synthesis fallback')
        const durationMs = await playWithSpeechSynthesis(text, {
          onStart: options?.onPlaybackStart,
        })
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

      const { email: preferredEmail, emailsEnabled } = readEmailPreferences(normalizedHandle)
      const trimmedEmail = preferredEmail && preferredEmail.trim().length ? preferredEmail.trim() : undefined
      const emailForSession = emailsEnabled ? trimmedEmail : undefined

      const payload = {
        sessionId,
        sessionAudioUrl: sessionAudioUrl || undefined,
        sessionAudioDurationMs: sessionAudioDurationMs || undefined,
        email: emailForSession,
        emailsEnabled,
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
        const historyKey = scopedStorageKey(DEMO_HISTORY_BASE_KEY, normalizedHandle)
        const demo = JSON.parse(localStorage.getItem(historyKey) || '[]')
        const stamp = new Date().toISOString()
        const summaryTitle =
          generateSessionTitle(conversationRef.current, {
            fallback: `Session on ${new Date(stamp).toLocaleDateString()}`,
          }) || null
        demo.unshift({ id: sessionId, created_at: stamp, title: summaryTitle })
        localStorage.setItem(historyKey, JSON.stringify(demo.slice(0, 50)))
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
  }, [normalizedHandle, pushLog, sessionId, toDone, updateMachineState])

  const requestManualStop = useCallback(() => {
    if (!inTurnRef.current) return
    if (manualStopRef.current) return
    manualStopRef.current = true
    setManualStopRequested(true)
    pushLog('Manual stop requested')
  }, [manualStopRef, pushLog])

  const publishTranscriptSynopsis = useCallback((payload: DiagnosticTranscriptPayload) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(DIAGNOSTIC_TRANSCRIPT_STORAGE_KEY, JSON.stringify(payload))
    } catch {}
  }, [])

  const publishProviderError = useCallback((payload: DiagnosticProviderErrorPayload | null) => {
    if (typeof window === 'undefined') return
    try {
      if (payload) {
        window.localStorage.setItem(DIAGNOSTIC_PROVIDER_ERROR_STORAGE_KEY, JSON.stringify(payload))
      } else {
        window.localStorage.removeItem(DIAGNOSTIC_PROVIDER_ERROR_STORAGE_KEY)
      }
    } catch {}
  }, [])

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
    const currentTurnNumber = turn + 1
    let diagnosticSynopsis: DiagnosticTranscriptPayload | null = null
    try {
      let b64 = ''
      let recDuration = 0
      let baselineToUse = baselineRef.current ?? DEFAULT_BASELINE
      let recMeta = { started: false, stopReason: 'unknown' as string }
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
        recMeta = { started: Boolean(rec.started), stopReason: rec.stopReason || 'unknown' }
      } catch {
        const silent = new Blob([new Uint8Array(1)], { type: 'audio/webm' })
        b64 = await blobToBase64(silent)
        recDuration = 500
        recMeta = { started: false, stopReason: 'record_error' }
      }
      const manualStopDuringTurn = manualStopRef.current
      if (recDuration < 100) {
        pushLog(`Warning: captured very short audio (${Math.round(recDuration)}ms).`)
        const detailParts = [
          `started=${recMeta.started ? 'yes' : 'no'}`,
          `manual_stop=${manualStopDuringTurn ? 'yes' : 'no'}`,
          `stop_reason=${recMeta.stopReason}`,
        ]
        pushLog(`turn dropped: silent audio (${detailParts.join(', ')})`)
        diagnosticSynopsis = {
          text: '',
          turn: currentTurnNumber,
          at: new Date().toISOString(),
          isEmpty: true,
          reason: manualStopDuringTurn
            ? 'manual_stop'
            : recMeta.started
            ? 'short_audio'
            : 'no_voice_detected',
          meta: { ...recMeta, manualStop: manualStopDuringTurn },
          provider: null,
        }
      }
      manualStopRef.current = false
      setManualStopRequested(false)
      pushLog('Recording stopped → thinking')
      updateMachineState('thinking')

      let askRes: AskResponse = {
        reply: 'Tell me one small detail you remember from that moment.',
        transcript: '',
        end_intent: false,
      }
      let askResStatus: number | null = null
      let providerErrorForTurn: DiagnosticProviderErrorPayload | null = null
      try {
        const res = await fetch('/api/ask-audio', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audio: b64, format: 'webm', sessionId, turn: turn + 1 }),
        })
        askResStatus = res.status
        const rawText = await res.text()
        let parsed: AskResponse | null = null
        if (rawText && rawText.length) {
          try {
            parsed = JSON.parse(rawText) as AskResponse
          } catch {
            parsed = null
          }
        }
        if (parsed && typeof parsed === 'object') {
          askRes = parsed
        }
        if (!res.ok) {
          providerErrorForTurn = {
            status: askResStatus,
            message: res.statusText || 'ask-audio request failed',
            reason: askRes?.debug?.reason || 'ask_audio_http_error',
            snippet: rawText ? truncateForLog(rawText, 200) : undefined,
            at: new Date().toISOString(),
          }
        }
      } catch (err) {
        providerErrorForTurn = {
          status: null,
          message: err instanceof Error ? err.message : 'Request failed',
          reason: 'ask_audio_network_error',
          at: new Date().toISOString(),
        }
      }

      const reply: string = askRes?.reply || 'Tell me one small detail you remember from that moment.'
      const transcript: string = askRes?.transcript || ''
      const endIntent: boolean = askRes?.end_intent === true
      const turnNumber = currentTurnNumber
      const askDebug = askRes?.debug
      const providerStatus = typeof askDebug?.providerStatus === 'number' ? askDebug.providerStatus : null
      const providerErrorMessage =
        typeof askDebug?.providerError === 'string' && askDebug.providerError.trim().length
          ? askDebug.providerError.trim()
          : undefined
      if (
        askDebug?.reason === 'provider_error' ||
        (typeof providerStatus === 'number' && providerStatus >= 400)
      ) {
        providerErrorForTurn = {
          status: providerStatus ?? null,
          message: providerErrorMessage || 'Provider request failed',
          reason: askDebug?.reason || 'provider_error',
          snippet: askDebug?.providerResponseSnippet
            ? truncateForLog(askDebug.providerResponseSnippet, 200)
            : undefined,
          at: new Date().toISOString(),
        }
      }
      if (!providerErrorForTurn && askRes && askRes.ok === false) {
        providerErrorForTurn = {
          status: providerStatus ?? askResStatus,
          message:
            providerErrorMessage ||
            (typeof askRes.reply === 'string' && askRes.reply.trim().length
              ? askRes.reply.trim()
              : 'ask-audio returned an error'),
          reason: askDebug?.reason || 'ask_audio_error',
          snippet: askDebug?.providerResponseSnippet
            ? truncateForLog(askDebug.providerResponseSnippet, 200)
            : undefined,
          at: new Date().toISOString(),
        }
      }
      if (providerErrorForTurn) {
        providerErrorRef.current = { ...providerErrorForTurn, resolved: false }
        setProviderError(providerErrorRef.current)
        publishProviderError(providerErrorRef.current)
        pushLog(
          `[turn ${turnNumber}] Provider error flagged → ${
            providerErrorForTurn.status ? `HTTP ${providerErrorForTurn.status}` : 'request failed'
          } [${providerErrorForTurn.reason || 'unknown'}] ${truncateForLog(
            providerErrorForTurn.message,
            160,
          )}`,
        )
      } else {
        if (providerErrorRef.current && providerErrorRef.current.resolved !== true) {
          const resolvedPayload: DiagnosticProviderErrorPayload = {
            ...providerErrorRef.current,
            resolved: true,
            resolvedAt: new Date().toISOString(),
          }
          providerErrorRef.current = resolvedPayload
          publishProviderError(resolvedPayload)
        }
        setProviderError(null)
      }
      if (askDebug?.memory) {
        const memoryParts: string[] = []
        memoryParts.push(`prior sessions: ${askDebug.memory.hasPriorSessions ? 'yes' : 'no'}`)
        memoryParts.push(`current turns: ${askDebug.memory.hasCurrentConversation ? 'yes' : 'no'}`)
        if (askDebug.memory.highlightDetail) {
          memoryParts.push(`highlight: ${truncateForLog(askDebug.memory.highlightDetail || '', 120)}`)
        }
        if (askDebug.memory.historyPreview) {
          memoryParts.push(`history preview: ${truncateForLog(askDebug.memory.historyPreview, 160)}`)
        }
        if (memoryParts.length) {
          pushLog(`[turn ${turnNumber}] Memory snapshot → ${memoryParts.join(' · ')}`)
        }
        if (askDebug.memory.recentConversationPreview) {
          pushLog(
            `[turn ${turnNumber}] Recent conversation preview → ${truncateForLog(
              askDebug.memory.recentConversationPreview,
              180,
            )}`,
          )
        }
        if (askDebug.memory.askedQuestionsPreview && askDebug.memory.askedQuestionsPreview.length) {
          const avoidList = formatPreviewList(askDebug.memory.askedQuestionsPreview, 4)
          if (avoidList) {
            pushLog(`[turn ${turnNumber}] Avoid repeating → ${avoidList}`)
          }
        }
        if (askDebug.memory.primerPreview) {
          pushLog(`[turn ${turnNumber}] Primer preview → ${truncateForLog(askDebug.memory.primerPreview, 160)}`)
        }
      }

      const transcriptLog = transcript.trim().length ? truncateForLog(transcript, 200) : ''
      const providerLabel = askDebug?.usedFallback
        ? `fallback (${askDebug.reason || 'guard'})`
        : askDebug?.provider || askRes?.provider || 'assistant'
      if (diagnosticSynopsis) {
        diagnosticSynopsis = { ...diagnosticSynopsis, provider: providerLabel }
      }

      if (transcriptLog) {
        pushLog(`[turn ${turnNumber}] Heard → ${transcriptLog}`)
        publishTranscriptSynopsis({
          text: transcriptLog,
          turn: turnNumber,
          at: new Date().toISOString(),
          isEmpty: false,
          meta: { ...recMeta, manualStop: manualStopDuringTurn },
          provider: providerLabel,
        })
        diagnosticSynopsis = null
      } else {
        pushLog(`[turn ${turnNumber}] Heard → (no transcript captured)`)
        if (!diagnosticSynopsis) {
          diagnosticSynopsis = {
            text: '',
            turn: turnNumber,
            at: new Date().toISOString(),
            isEmpty: true,
            reason: 'no_transcript_returned',
            meta: { ...recMeta, manualStop: manualStopDuringTurn },
            provider: providerLabel,
          }
        }
        if (diagnosticSynopsis) {
          publishTranscriptSynopsis(diagnosticSynopsis)
        }
      }

      pushLog(`[turn ${turnNumber}] Reply via ${providerLabel} → ${truncateForLog(reply, 200)}`)
      if (askDebug?.providerResponseSnippet) {
        pushLog(
          `[turn ${turnNumber}] Provider snippet → ${truncateForLog(askDebug.providerResponseSnippet, 200)}`,
        )
      }
      if (typeof providerStatus === 'number') {
        pushLog(`[turn ${turnNumber}] Provider status → ${providerStatus}`)
      }
      if (providerErrorMessage) {
        pushLog(`[turn ${turnNumber}] Provider error → ${truncateForLog(providerErrorMessage, 160)}`)
      }
      if (askDebug?.usedFallback && askDebug.reason) {
        pushLog(`[turn ${turnNumber}] Fallback reason → ${truncateForLog(askDebug.reason, 160)}`)
      }
      if (transcript) {
        conversationRef.current.push({ role: 'user', text: transcript })
      }
      if (reply) {
        conversationRef.current.push({ role: 'assistant', text: reply })
      }

      const completionIntent = detectCompletionIntent(transcript)
      const completionDetected = completionIntent.shouldStop && completionIntent.confidence !== 'low'
      const providerSuggestedStop = endIntent === true
      if (completionIntent.shouldStop) {
        const match = completionIntent.matchedPhrases.join(', ')
        const suffix = match.length ? `: ${match}` : ''
        if (completionDetected) {
          pushLog(`Completion intent detected (${completionIntent.confidence})${suffix}`)
        } else {
          pushLog(`Low-confidence completion intent ignored (${completionIntent.confidence})${suffix}`)
        }
      }

      let assistantPlayback: AssistantPlayback = { base64: null, mime: 'audio/mpeg', durationMs: 0 }
      let playbackStarted = false
      pushLog('Preparing assistant audio')
      updateMachineState('speakingPrep')
      try {
        assistantPlayback = await playAssistantResponse(reply, {
          onPlaybackStart: () => {
            playbackStarted = true
            updateMachineState('playing')
          },
        })
        if (!playbackStarted) {
          updateMachineState('playing')
        }
      } catch {
        if (!playbackStarted) {
          updateMachineState('playing')
        }
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
      if (providerSuggestedStop && !completionDetected && !finishRequestedRef.current) {
        pushLog('Provider end intent ignored—no user stop detected')
      }

      const shouldEnd =
        finishRequestedRef.current || reachedMax || completionDetected
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
      if (diagnosticSynopsis) {
        publishTranscriptSynopsis({
          ...diagnosticSynopsis,
          at: new Date().toISOString(),
          reason: diagnosticSynopsis.reason || 'turn_error',
        })
      }
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
    publishProviderError,
    publishTranscriptSynopsis,
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
    const introPrepStartedAt = Date.now()
    const ensureIntroDelay = async () => {
      const elapsed = Date.now() - introPrepStartedAt
      const waitMs = INTRO_MIN_PREP_MS - elapsed
      if (waitMs > 0) {
        if (waitMs > 50) {
          pushLog(`Intro ready. Waiting ${waitMs}ms to finish memory sync…`)
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
    let introMessage = ''
    let introSource: 'model' | 'fallback' = 'model'
    try {
      try {
        await ensureSessionRecorder()
      } catch {
        pushLog('Session recorder unavailable; proceeding without combined audio')
      }

      try {
        const res = await fetch(`/api/session/${sessionId}/intro`, { method: 'POST' })
        const json = (await res.json().catch(() => null)) as IntroResponse | null
        if (res.ok && typeof json?.message === 'string' && json.message.trim().length) {
          introMessage = json.message.trim()
        }
        introSource = json?.fallback ? 'fallback' : 'model'
        if (json?.debug) {
          const parts: string[] = []
          if (json.debug.hasPriorSessions) {
            const sessionCount = typeof json.debug.sessionCount === 'number' ? json.debug.sessionCount : undefined
            parts.push(`history sessions: ${sessionCount ? String(sessionCount) : 'yes'}`)
          } else {
            parts.push('history sessions: none yet')
          }
          const rememberedDetails = formatPreviewList(json.debug.rememberedDetails, 3)
          if (rememberedDetails) {
            parts.push(`details: ${rememberedDetails}`)
          }
          const rememberedTitles = formatPreviewList(json.debug.rememberedTitles, 3)
          if (rememberedTitles) {
            parts.push(`titles: ${rememberedTitles}`)
          }
          if (json.debug.fallbackQuestion && json.debug.fallbackQuestion.trim().length) {
            parts.push(`fallback question: ${truncateForLog(json.debug.fallbackQuestion, 120)}`)
          }
          if (parts.length) {
            pushLog(`[init] Memory snapshot → ${parts.join(' · ')}`)
          }
          if (json.debug.askedQuestionsPreview && json.debug.askedQuestionsPreview.length) {
            const avoidList = formatPreviewList(json.debug.askedQuestionsPreview, 4)
            if (avoidList) {
              pushLog(`[init] Avoid repeating → ${avoidList}`)
            }
          }
          if (json.debug.primerPreview) {
            pushLog(`[init] Primer preview → ${truncateForLog(json.debug.primerPreview, 180)}`)
          }
        }
        if (json?.reason) {
          pushLog(`[init] Intro fallback reason → ${truncateForLog(json.reason, 160)}`)
        }
        if (json?.fallback === true && !introMessage) {
          pushLog('[init] Intro response fell back to default prompt')
        }
      } catch (err) {
        pushLog('Intro prompt unavailable; using fallback greeting')
        introSource = 'fallback'
      }

      if (!introMessage) {
        introMessage = INTRO_FALLBACK
        introSource = 'fallback'
      }

      pushLog(`[init] Intro message (${introSource}): ${truncateForLog(introMessage, 220)}`)

      conversationRef.current.push({ role: 'assistant', text: introMessage })

      try {
        await fetch(`/api/session/${sessionId}/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', text: introMessage }),
        })
      } catch {}

      await ensureIntroDelay()
      pushLog('Intro message ready → playing')
      let introPlaybackStarted = false
      updateMachineState('speakingPrep')
      try {
        await playAssistantResponse(introMessage, {
          onPlaybackStart: () => {
            introPlaybackStarted = true
            updateMachineState('playing')
          },
        })
      } catch {
        try {
          await playWithSpeechSynthesis(introMessage, {
            onStart: () => {
              introPlaybackStarted = true
              updateMachineState('playing')
            },
          })
        } catch {}
      } finally {
        if (!introPlaybackStarted) {
          updateMachineState('playing')
        }
      }
    } catch {
      await ensureIntroDelay()
      let introFallbackStarted = false
      updateMachineState('speakingPrep')
      try {
        await playWithSpeechSynthesis(INTRO_FALLBACK, {
          onStart: () => {
            introFallbackStarted = true
            updateMachineState('playing')
          },
        })
      } catch {}
      if (!introFallbackStarted) {
        updateMachineState('playing')
      }
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
      case 'speakingPrep':
        return 'Warming up my voice so I can respond clearly.'
      case 'playing':
        return 'Sharing what I heard and how we can keep going.'
      case 'readyToContinue':
        return 'I’m ready whenever you are—just start speaking.'
      default:
        return visual.description
    }
  })()
  const heroTone = finishRequested
    ? { accent: '#f97316', gradient: 'linear-gradient(135deg, rgba(255, 186, 102, 0.36), rgba(255, 247, 237, 0.88))' }
    : manualStopRequested
      ? { accent: '#ef4444', gradient: 'linear-gradient(135deg, rgba(248, 113, 113, 0.26), rgba(244, 114, 182, 0.22))' }
      : visual.tone
  const heroStyles = {
    '--hero-accent': heroTone.accent,
    '--hero-gradient': heroTone.gradient,
  } as CSSProperties
  const heroButtonClasses = ['hero-button']
  if (finishRequested) {
    heroButtonClasses.push('is-finishing')
  } else if (manualStopRequested) {
    heroButtonClasses.push('is-stopping')
  } else if (machineState === 'recording') {
    heroButtonClasses.push('is-recording')
  }
  const heroAriaLabel = finishRequested
    ? 'Wrapping up the session'
    : manualStopRequested
      ? 'Stopping the recording'
      : machineState === 'recording'
        ? 'Listening. Tap to finish your turn.'
        : machineState === 'calibrating'
          ? 'Calibrating the microphone baseline'
          : machineState === 'speakingPrep'
            ? 'Preparing to speak'
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
      case 'speakingPrep':
        return 'Getting ready to speak with you.'
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

  const providerErrorTimestamp = providerError?.at
    ? (() => {
        const parsed = new Date(providerError.at)
        if (Number.isNaN(parsed.valueOf())) return 'time unknown'
        if (easternTimeFormatter) {
          try {
            return `${easternTimeFormatter.format(parsed)} Eastern Time`
          } catch {
            return parsed.toLocaleString()
          }
        }
        return parsed.toLocaleString()
      })()
    : null
  const providerErrorStatusLabel = providerError?.status
    ? `HTTP ${providerError.status}`
    : providerError
    ? 'Request failed'
    : null

  return (
    <main className="home-main">
      <div className="panel-card hero-card">
        {displayHandle && (
          <div className="account-chip">
            Account: <span className="highlight">@{displayHandle.toLowerCase()}</span>
          </div>
        )}
        {providerError && (
          <div className="alert-banner alert-banner--error" role="alert">
            <div className="alert-banner__title">
              ⚠️ Trouble reaching Google
              {providerErrorStatusLabel ? ` · ${providerErrorStatusLabel}` : ''}
            </div>
            <div className="alert-banner__message">{providerError.message}</div>
            <div className="alert-banner__meta">
              Captured {providerErrorTimestamp || 'time unknown'} · Reason:{' '}
              {providerError.reason ? providerError.reason.replace(/_/g, ' ') : 'unspecified'} ·{' '}
              <a className="link" href={diagnosticsHref}>
                Review diagnostics
              </a>
            </div>
            {providerError.snippet && (
              <pre className="alert-banner__snippet">{providerError.snippet}</pre>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={handleHeroPress}
          className={heroButtonClasses.join(' ')}
          aria-label={heroAriaLabel}
          style={heroStyles}
        >
          <span className="hero-button__gradient" aria-hidden="true" />
          <span className="hero-button__pulse" aria-hidden="true" />
          <span className="hero-button__dot" aria-hidden="true" />
          <span className="hero-button__content">
            <span className="hero-button__icon" aria-hidden="true">
              {heroIcon}
            </span>
            <span className="hero-button__badge">{heroBadge}</span>
            <span className="hero-button__title">{heroTitle}</span>
            <span className="hero-button__description">{heroDescription}</span>
          </span>
        </button>

        <div className="status-block">
          <div className="status-text">{statusMessage}</div>
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
              className="btn-secondary btn-large"
            >
              Start Again
            </button>
          ) : null}
          {machineState !== 'doneSuccess' && (
            <button
              onClick={requestFinish}
              disabled={!hasStarted || finishRequested}
              className="btn-outline"
            >
              I’m finished
            </button>
          )}
        </div>
      </div>

      <div className="panel-card diagnostics-card">
        <div className="diagnostics-head">
          <span>Diagnostics log</span>
          <a className="diagnostics-link" href={diagnosticsHref}>
            Open
          </a>
        </div>
        <textarea value={debugLog.join('\n')} readOnly rows={6} className="diagnostics-log" />
        <div className="page-subtext">
          Need more detail?{' '}
          <a className="link" href={diagnosticsHref}>
            Visit Diagnostics
          </a>
          .
        </div>
      </div>
    </main>
  )
}
