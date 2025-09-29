import { NextRequest, NextResponse } from 'next/server'
import { ensureSessionMemoryHydrated, getMemoryPrimer, getSessionMemorySnapshot } from '@/lib/data'
import {
  buildMemoryLogDocument,
  buildMemoryPrimerPreview,
  collectAskedQuestions,
  extractAskedQuestions,
  findLatestUserDetails,
  normalizeQuestion,
  pickFallbackQuestion,
  extractPrimerHighlights,
  sessionHasUserDetail,
} from '@/lib/question-memory'
import { normalizeHandle } from '@/lib/user-scope'
import { detectCompletionIntent } from '@/lib/intents'

const SYSTEM_PROMPT = `You are the voice of Dad's Interview Bot, a warm, curious biographer who helps families preserve their memories.
Mission:
- Open every reply by restating the goal of saving their stories and reassuring them you will remember what they share.
- When the memory prompt shows no past sessions and no turns yet, deliver the bespoke welcome: introduce Dad's Interview Bot, explain that you're here to capture their memories, and invite them to begin when they're ready.
- When history exists, greet them as a returning storyteller, mention you're continuing their archive, and refer to the provided highlight detail if one is available (never invent a detail).
Core responsibilities:
- Listen closely to the newest user message. When audio is provided, transcribe it carefully into natural written English before responding.
- Summarize or acknowledge the user's latest contribution before moving the conversation forward.
Guidelines:
- Never repeat or closely paraphrase the user's exact phrasing.
- Follow the user's lead and respond directly to any instruction, question, or aside before offering a new prompt.
- Be flexible; if the user hesitates, gently shift the angle instead of repeating yourself.
- Ask at most one short, specific, open-ended question (<= 20 words) only when the user seems ready to continue, and never repeat a question listed in the memory section.
- When you reference remembered material, clearly say you are remembering it for them.
- If the user indicates they are finished, set end_intent to true, respond warmly, and do not ask another question.
Formatting:
- Always respond with valid JSON matching {"reply":"...","transcript":"...","end_intent":true|false}. Do not include commentary, explanations, or code fences.
- The "transcript" field must contain the user's latest message in text form (use your own transcription when audio is supplied).
- Keep the spoken reply under 120 words, natural, and conversational.`

function safeJsonParse(input: string | null | undefined) {
  if (!input) return {}
  try {
    return JSON.parse(input)
  } catch {
    return {}
  }
}

function parseJsonFromText(raw: string | null | undefined) {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed.length) return null
  const withoutFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const attempts = [withoutFence]
  const firstBrace = withoutFence.indexOf('{')
  const lastBrace = withoutFence.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(withoutFence.slice(firstBrace, lastBrace + 1))
  }
  for (const attempt of attempts) {
    const candidate = attempt.trim()
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }
  return null
}

type AskAudioBody = {
  audio?: string
  format?: string
  text?: string
  sessionId?: string
  turn?: number
  userHandle?: string
  user_handle?: string
}

type AskAudioResponse = {
  ok: boolean
  provider: string
  reply: string
  transcript: string
  end_intent: boolean
  debug?: {
    sessionId: string | null
    turn: number | null
    provider: string
    usedFallback: boolean
    reason?: string
    providerResponseSnippet?: string
    memoryLog?: string
    memory?: {
      hasPriorSessions: boolean
      hasCurrentConversation: boolean
      highlightDetail: string | null
      recentConversationPreview: string
      recentConversationFull?: string
      historyPreview: string
      historyFull?: string
      questionPreview: string
      questionFull?: string
      primerPreview: string
      primerFull?: string
      askedQuestionsPreview: string[]
      primerHighlights?: string[]
    }
  }
}

type AskAudioDebug = NonNullable<AskAudioResponse['debug']>

type MemoryPrompt = {
  historyText: string
  questionText: string
  recentConversation: string
  askedQuestions: string[]
  highlightDetail?: string
  primerText: string
  primerHighlights: string[]
  hasPriorSessions: boolean
  hasCurrentConversation: boolean
  handle?: string | null
  sessionCount: number
  memoryLog: string
}

function softenQuestion(question: string | null | undefined): string {
  if (!question) return ''
  const trimmed = question.trim()
  if (!trimmed.length) return ''
  const withoutQuestion = trimmed.replace(/[?]+$/, '')
  const lowered = withoutQuestion.charAt(0).toLowerCase() + withoutQuestion.slice(1)
  return `If you'd like, I'm curious: ${lowered}?`
}

async function buildMemoryPrompt(
  sessionId: string | undefined,
  options: { handle?: string | null } = {},
): Promise<MemoryPrompt> {
  const requestedHandle = normalizeHandle(options.handle ?? undefined)
  const { current, sessions } = getSessionMemorySnapshot(sessionId, { handle: requestedHandle })
  const priorSessions = sessions.filter((session) => session.id !== sessionId)
  const priorSessionsWithDetails = priorSessions.filter(sessionHasUserDetail)
  const derivedHandle =
    requestedHandle ??
    normalizeHandle(current?.user_handle ?? undefined) ??
    normalizeHandle(sessions[0]?.user_handle ?? undefined)
  const primerResult = await getMemoryPrimer(derivedHandle ?? null)
  const primerFromStorage = primerResult.text?.trim() ?? ''
  const hasPriorSessions = priorSessionsWithDetails.length > 0 || primerFromStorage.length > 0
  const askedQuestionSource = current ? [current, ...priorSessions] : sessions
  const askedQuestions = collectAskedQuestions(askedQuestionSource)
  const primerHighlights = extractPrimerHighlights(primerFromStorage)
  const highlightDetail =
    primerHighlights[0] ?? findLatestUserDetails(priorSessionsWithDetails, { limit: 1 })[0]
  const fallbackPrimer = buildMemoryPrimerPreview(priorSessionsWithDetails, { limit: 4 })
  const primerText = primerFromStorage || fallbackPrimer
  const sessionCount = sessions.length

  const historyLines: string[] = []
  if (priorSessions.length) {
    historyLines.push('Highlights from previous sessions:')
    for (const session of priorSessions.slice(0, 4)) {
      const title = session.title ? session.title : `Session from ${new Date(session.created_at).toLocaleDateString()}`
      const recentDetail = findLatestUserDetails([session], { limit: 1 })[0]
      historyLines.push(`- ${title}${recentDetail ? ` → ${recentDetail}` : ''}`)
    }
  }

  const conversationLines: string[] = []
  const currentTurns = current?.turns ?? []
  const hasCurrentConversation = currentTurns.length > 0
  if (hasCurrentConversation) {
    conversationLines.push('Current session so far:')
    for (const turn of currentTurns.slice(-6)) {
      const roleLabel = turn.role === 'assistant' ? 'You' : 'User'
      conversationLines.push(`${roleLabel}: ${turn.text}`)
    }
  }

  const uniqueQuestions: string[] = []
  const seen = new Set<string>()
  for (const question of askedQuestions) {
    const normalized = normalizeQuestion(question)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    uniqueQuestions.push(question)
    if (uniqueQuestions.length >= 20) break
  }

  const questionLines = uniqueQuestions.length
    ? ['Avoid repeating these prior questions:', ...uniqueQuestions.map((question) => `- ${question}`)]
    : ['No prior questions are on record.']

  const historyText = historyLines.length ? historyLines.join('\n') : 'No previous transcript details are available yet.'
  const questionText = questionLines.join('\n')
  const recentConversation = conversationLines.join('\n')
  const memoryLog = buildMemoryLogDocument({
    handle: derivedHandle ?? null,
    sessionId: sessionId ?? null,
    sessions,
    current,
    hasPriorSessions,
    hasCurrentConversation,
    highlightDetail: highlightDetail ?? null,
    historyText,
    questionText,
    primerText,
    askedQuestions,
  })

  return {
    historyText,
    questionText,
    recentConversation,
    askedQuestions,
    highlightDetail,
    primerText,
    primerHighlights,
    hasPriorSessions,
    hasCurrentConversation,
    handle: derivedHandle ?? null,
    sessionCount,
    memoryLog,
  }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') || process.env.PROVIDER || 'google'
  let requestTurn: number | null = null
  let requestSessionId: string | undefined
  let debugMemory: AskAudioDebug['memory'] | undefined
  let memoryLogPreview: string | undefined
  try {
    const raw = await req.text().catch(() => '')
    const body: AskAudioBody = raw && raw.length ? safeJsonParse(raw) : {}
    const { audio, format = 'webm', text, sessionId } = body || {}
    const requestHandleRaw =
      typeof body?.userHandle === 'string'
        ? body.userHandle
        : typeof body?.user_handle === 'string'
        ? body.user_handle
        : undefined
    const normalizedHandle = normalizeHandle(requestHandleRaw ?? undefined)
    requestTurn = typeof body?.turn === 'number' ? body.turn : null
    requestSessionId = typeof sessionId === 'string' && sessionId ? sessionId : undefined

    if (sessionId) {
      await ensureSessionMemoryHydrated().catch(() => undefined)
    }
    const memory = await buildMemoryPrompt(sessionId, { handle: normalizedHandle })
    memoryLogPreview = memory.memoryLog.slice(0, 2000)
    debugMemory = {
      hasPriorSessions: memory.hasPriorSessions,
      hasCurrentConversation: memory.hasCurrentConversation,
      highlightDetail: memory.highlightDetail ?? null,
      recentConversationPreview: memory.recentConversation.slice(0, 400),
      recentConversationFull: memory.recentConversation.slice(0, 2000),
      historyPreview: memory.historyText.slice(0, 400),
      historyFull: memory.historyText.slice(0, 2000),
      questionPreview: memory.questionText.slice(0, 400),
      questionFull: memory.questionText.slice(0, 2000),
      primerPreview: memory.primerText.slice(0, 400),
      primerFull: memory.primerText.slice(0, 2000),
      askedQuestionsPreview: memory.askedQuestions.slice(0, 10),
      primerHighlights: memory.primerHighlights.slice(0, 6),
    }
    const debugBase = {
      sessionId: requestSessionId ?? null,
      turn: requestTurn,
      provider,
      memoryLog: memoryLogPreview,
      memory: debugMemory,
    }
    const fallbackQuestion = pickFallbackQuestion(memory.askedQuestions, memory.highlightDetail)
    const fallbackSuggestion = softenQuestion(fallbackQuestion)
    const fallbackReply = !memory.hasPriorSessions && !memory.hasCurrentConversation
      ? "Hi, I'm Dad's Interview Bot. I'm here to help you save the stories and small details your family will want to revisit. When it feels right, let's begin with a memory you'd like me to hold onto—what comes to mind first?"
      : memory.highlightDetail
      ? `Welcome back. I'm still remembering what you told me about ${memory.highlightDetail}, and I'm ready to keep your archive growing.${
          fallbackSuggestion ? ` ${fallbackSuggestion}` : ''
        }`
      : `Welcome back—your story archive is open and I'm keeping every detail you share safe.${
          fallbackSuggestion ? ` ${fallbackSuggestion}` : ''
        }`

    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json<AskAudioResponse>({
        ok: true,
        provider,
        reply: fallbackReply,
        transcript: text || '',
        end_intent: detectCompletionIntent(text || '').shouldStop,
        debug: { ...debugBase, usedFallback: true, reason: 'missing_api_key' },
      })
    }

    const primerSnippet = memory.primerText ? memory.primerText.slice(0, 6000) : ''
    const parts: any[] = [{ text: SYSTEM_PROMPT }]
    if (primerSnippet) {
      parts.push({ text: `Memory primer:\n${primerSnippet}` })
    }
    parts.push({ text: memory.historyText })
    parts.push({ text: memory.questionText })
    if (memory.recentConversation) {
      parts.push({ text: memory.recentConversation })
    }
    if (memory.highlightDetail) {
      parts.push({ text: `Recent remembered detail: ${memory.highlightDetail}` })
    }
    if (audio) parts.push({ inlineData: { mimeType: `audio/${format}`, data: audio } })
    if (text) parts.push({ text })
    parts.push({ text: 'Respond only with JSON in the format {"reply":"...","transcript":"...","end_intent":false}.' })

    const model = process.env.GOOGLE_MODEL || 'gemini-1.5-flash'
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
      },
    )
    const json = await response.json().catch(() => ({}))
    const txt =
      json?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').filter(Boolean).join('\n') || ''

    const fallback: AskAudioResponse = {
      ok: true,
      provider: 'google',
      reply: fallbackReply,
      transcript: text || '',
      end_intent: detectCompletionIntent(text || '').shouldStop,
      debug: { ...debugBase, usedFallback: true, reason: 'fallback_guard' },
    }

    const parsed = parseJsonFromText(txt)
    if (parsed && typeof parsed === 'object') {
      const rawReply =
        typeof (parsed as any).reply === 'string' && (parsed as any).reply.trim().length
          ? (parsed as any).reply.trim()
          : ''
      const transcriptText =
        typeof (parsed as any).transcript === 'string' && (parsed as any).transcript.trim().length
          ? (parsed as any).transcript
          : fallback.transcript || ''
      const completion = detectCompletionIntent(transcriptText || text || '')

      let candidateQuestion =
        typeof (parsed as any).question === 'string' && (parsed as any).question.trim().length
          ? (parsed as any).question.trim()
          : null

      if (!candidateQuestion && rawReply) {
        const questionsInReply = extractAskedQuestions(rawReply)
        if (questionsInReply.length) {
          candidateQuestion = questionsInReply[questionsInReply.length - 1]
        }
      }

      if (candidateQuestion) {
        const normalizedCandidate = normalizeQuestion(candidateQuestion)
        if (
          normalizedCandidate &&
          memory.askedQuestions.some((question) => normalizeQuestion(question) === normalizedCandidate)
        ) {
          candidateQuestion = fallbackQuestion
        }
      }

      let reply = rawReply
      if (candidateQuestion) {
        reply = reply && !reply.includes(candidateQuestion) ? `${reply} ${candidateQuestion}`.trim() : reply || candidateQuestion
      } else if (fallbackSuggestion) {
        reply = reply ? `${reply} ${fallbackSuggestion}`.trim() : fallbackSuggestion
      }

      if (!reply) {
        reply = fallbackReply
      }

      reply = reply.trim()

      const extractedQuestions = extractAskedQuestions(reply)
      const normalizedFinalQuestion = extractedQuestions.length
        ? normalizeQuestion(extractedQuestions[extractedQuestions.length - 1])
        : ''
      if (
        normalizedFinalQuestion &&
        memory.askedQuestions.some((question) => normalizeQuestion(question) === normalizedFinalQuestion)
      ) {
        reply = reply.includes(fallbackQuestion) ? reply : `${reply} ${fallbackQuestion}`.trim()
      }

      return NextResponse.json({
        ok: true,
        provider: 'google',
        reply,
        transcript: transcriptText,
        end_intent: Boolean((parsed as any).end_intent) || completion.shouldStop,
        debug: {
          ...debugBase,
          usedFallback: false,
          providerResponseSnippet: txt.slice(0, 400),
        },
      })
    }

    const normalized = normalizeQuestion(txt)
    if (normalized && memory.askedQuestions.some((question) => normalizeQuestion(question) === normalized)) {
      return NextResponse.json(fallback)
    }
    const completion = detectCompletionIntent(txt || text || '')
    return NextResponse.json({
      ...fallback,
      reply: txt || fallback.reply,
      transcript: txt || fallback.transcript || '',
      end_intent: fallback.end_intent || completion.shouldStop,
      debug: {
        ...debugBase,
        usedFallback: true,
        reason: 'unstructured_response',
        providerResponseSnippet: txt.slice(0, 400),
      },
    })
  } catch (e) {
    return NextResponse.json<AskAudioResponse>({
      ok: true,
      provider,
      reply: 'Who else was there? Share a first name and one detail about them.',
      transcript: '',
      end_intent: false,
      debug: {
        sessionId: requestSessionId ?? null,
        turn: requestTurn,
        provider,
        usedFallback: true,
        reason: 'exception',
        memoryLog: memoryLogPreview,
        memory: debugMemory,
      },
    })
  }
}
