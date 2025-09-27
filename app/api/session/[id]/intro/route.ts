import { NextRequest, NextResponse } from 'next/server'
import { ensureSessionMemoryHydrated, getSessionMemorySnapshot } from '@/lib/data'
import {
  buildMemoryPrimerPreview,
  collectAskedQuestions,
  findLatestUserDetails,
  normalizeQuestion,
  pickFallbackQuestion,
  sessionHasUserDetail,
} from '@/lib/question-memory'

const INTRO_SYSTEM_PROMPT = `You are the opening voice of Dad's Interview Bot, a warm, curious biographer.
Mission:
- Introduce the recording session, state that you're here to help preserve the user's stories, and reassure them you will remember what they share.
- If the history is empty, deliver a unique welcome that explains the goal and invites them to begin when they feel ready.
- If history is present, greet them as a returning storyteller, mention that you're remembering their previous sessions (reference one or two provided details when available), and invite them to continue.
Instructions:
- Keep the spoken message under 120 words, conversational, and encouraging.
- Ask exactly one new, specific, open-ended question (<= 22 words) that does not repeat any question from the history section.
- Summarize or acknowledge relevant remembered details naturally, without repeating the user's exact phrasing.
- Respond only with JSON shaped as {"message":"<spoken message>","question":"<the follow-up question>"}. No commentary or code fences.`

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] || ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items[0]}, ${items[1]}, and ${items[2]}`
}

const FIRST_TIME_INTRO_QUESTION =
  "Would you start by telling me the first memory you'd like to save together?"

function buildFallbackIntro(options: {
  titles: string[]
  details: string[]
  question: string
  hasHistory: boolean
}): string {
  const { titles, details, question, hasHistory } = options
  const introPrefix = hasHistory
    ? titles.length
      ? `Welcome back—I'm keeping your stories about ${formatList(titles.slice(0, 3))} safe for you.`
      : "Welcome back—your archive is open and I'm ready whenever you are."
    : "Hi, I'm Dad's Interview Bot. I'm here to help you capture the memories you want to keep."
  const reminder = details.length
    ? `The last thing you shared was about ${details[0]}.`
    : "I'll remember every detail you share from this moment on."
  const invitation = hasHistory ? 'When you are ready,' : 'When you feel ready,'
  const closingQuestion = hasHistory
    ? question || 'Where would you like to pick up the story?'
    : FIRST_TIME_INTRO_QUESTION
  return `${introPrefix} ${reminder} ${invitation} ${closingQuestion}`.trim()
}

function buildHistorySummary(
  titles: string[],
  details: string[],
  askedQuestions: string[],
): { historyText: string; questionText: string } {
  const historyLines: string[] = []
  if (titles.length) {
    historyLines.push('Session titles remembered:')
    for (const title of titles.slice(0, 5)) {
      historyLines.push(`- ${title}`)
    }
  }
  if (details.length) {
    historyLines.push('Recent user details:')
    for (const detail of details.slice(0, 5)) {
      historyLines.push(`- ${detail}`)
    }
  }
  const historyText = historyLines.join('\n') || 'No previous transcript details are available yet.'

  const uniqueQuestions: string[] = []
  const seen = new Set<string>()
  for (const question of askedQuestions) {
    const normalized = normalizeQuestion(question)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    uniqueQuestions.push(question)
    if (uniqueQuestions.length >= 12) break
  }

  const questionLines = uniqueQuestions.length
    ? ['Avoid repeating these prior questions:', ...uniqueQuestions.map((question) => `- ${question}`)]
    : ['No prior questions are on record.']

  return { historyText, questionText: questionLines.join('\n') }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sessionId = params.id
  await ensureSessionMemoryHydrated().catch(() => undefined)
  const { current, sessions } = getSessionMemorySnapshot(sessionId)
  if (!current) {
    return NextResponse.json({ ok: false, error: 'session_not_found' }, { status: 404 })
  }

  const previousSessions = sessions.filter((session) => session.id !== sessionId)
  const previousSessionsWithDetails = previousSessions.filter(sessionHasUserDetail)
  const titles = previousSessions
    .map((session) => session.title)
    .filter((title): title is string => Boolean(title && title.trim().length))
    .slice(0, 5)
  const details = findLatestUserDetails(previousSessionsWithDetails, { limit: 3 })
  const askedQuestions = collectAskedQuestions(sessions)
  const fallbackQuestion = pickFallbackQuestion(askedQuestions, details[0])
  const hasHistory = previousSessionsWithDetails.length > 0
  const fallbackMessage = buildFallbackIntro({
    titles,
    details,
    question: fallbackQuestion,
    hasHistory,
  })
  const primerText = buildMemoryPrimerPreview(previousSessionsWithDetails, {
    heading: "Here's what I'm already remembering for you:",
    limit: 4,
  })

  const debug = {
    hasPriorSessions: previousSessionsWithDetails.length > 0,
    sessionCount: sessions.length,
    rememberedTitles: titles,
    rememberedDetails: details,
    askedQuestionsPreview: askedQuestions.slice(0, 10),
    primerPreview: primerText.slice(0, 400),
    fallbackQuestion,
  }

  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json({ ok: true, message: fallbackMessage, fallback: true, debug })
  }

  try {
    const { historyText, questionText } = buildHistorySummary(titles, details, askedQuestions)
    const parts: any[] = [{ text: INTRO_SYSTEM_PROMPT }]
    if (primerText.trim().length) {
      parts.push({ text: `Memory primer:\n${primerText.slice(0, 6000)}` })
    }
    parts.push({ text: historyText })
    parts.push({ text: questionText })
    parts.push({ text: 'Respond only with JSON in the format {"message":"...","question":"..."}.' })

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

    let message = ''
    try {
      const cleaned = txt.trim().replace(/^```(json)?/i, '').replace(/```$/i, '')
      const parsed = JSON.parse(cleaned)
      if (parsed && typeof parsed.message === 'string') {
        message = parsed.message.trim()
        if (parsed.question && typeof parsed.question === 'string') {
          const normalized = normalizeQuestion(parsed.question)
          if (normalized && askedQuestions.some((question) => normalizeQuestion(question) === normalized)) {
            message = `${message} ${fallbackQuestion}`.trim()
          }
        }
      }
    } catch {
      message = txt.trim()
    }

    if (!message || !message.includes('?')) {
      message = `${message ? `${message} ` : ''}${fallbackQuestion}`.trim()
    }

    if (!hasHistory) {
      const lowercaseMessage = message.toLowerCase()
      const hasWarmGreeting =
        lowercaseMessage.includes("i'm dad's interview bot") ||
        lowercaseMessage.includes('welcome') ||
        lowercaseMessage.includes('hello') ||
        lowercaseMessage.includes("i'm here to")
      if (!hasWarmGreeting) {
        message = fallbackMessage
      }
    }

    if (!message) {
      return NextResponse.json({ ok: true, message: fallbackMessage, fallback: true, debug })
    }

    return NextResponse.json({ ok: true, message, fallback: false, debug })
  } catch (error: any) {
    const reason = typeof error?.message === 'string' ? error.message : 'intro_failed'
    return NextResponse.json({ ok: true, message: fallbackMessage, fallback: true, reason, debug })
  }
}
