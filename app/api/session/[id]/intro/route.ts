import { NextRequest, NextResponse } from 'next/server'
import { getSessionMemorySnapshot } from '@/lib/data'
import { collectAskedQuestions, findLatestUserDetails, normalizeQuestion, pickFallbackQuestion } from '@/lib/question-memory'

const INTRO_SYSTEM_PROMPT = `You are a warm, patient biographer and this is the very first message in a new recording session.
Your goals:
- Welcome the user back, clearly stating you remember everything they have shared across all past sessions.
- Reference one or two concrete details or titles from the provided history when available.
- Ask exactly one new, specific, sensory-rich question (<= 25 words) that has not been asked before.
- The question must invite a short spoken response and avoid repeating previous questions verbatim.
Return JSON: {"message":"<spoken message including welcome and question>","question":"<just the final question>"}.
Keep the message under 120 words, warm, and conversational.`

function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] || ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items[0]}, ${items[1]}, and ${items[2]}`
}

function buildFallbackIntro(options: {
  titles: string[]
  details: string[]
  question: string
}): string {
  const { titles, details, question } = options
  const introPrefix = titles.length
    ? `Welcome back. I remember everything you've shared, especially ${formatList(titles.slice(0, 3))}.`
    : 'Welcome. I will remember everything you share with me.'
  const reminder = details.length
    ? `The last thing you told me was about ${details[0]}.`
    : 'Thank you for trusting me with your stories.'
  return `${introPrefix} ${reminder} ${question}`.trim()
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
  const { current, sessions } = getSessionMemorySnapshot(sessionId)
  if (!current) {
    return NextResponse.json({ ok: false, error: 'session_not_found' }, { status: 404 })
  }

  const previousSessions = sessions.filter((session) => session.id !== sessionId)
  const titles = previousSessions
    .map((session) => session.title)
    .filter((title): title is string => Boolean(title && title.trim().length))
    .slice(0, 5)
  const details = findLatestUserDetails(sessions, { excludeSessionId: sessionId, limit: 3 })
  const askedQuestions = collectAskedQuestions(sessions)
  const fallbackQuestion = pickFallbackQuestion(askedQuestions, details[0])
  const fallbackMessage = buildFallbackIntro({ titles, details, question: fallbackQuestion })

  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json({ ok: true, message: fallbackMessage, fallback: true })
  }

  try {
    const { historyText, questionText } = buildHistorySummary(titles, details, askedQuestions)
    const parts: any[] = [
      { text: INTRO_SYSTEM_PROMPT },
      { text: historyText },
      { text: questionText },
    ]

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

    if (!message) {
      return NextResponse.json({ ok: true, message: fallbackMessage, fallback: true })
    }

    return NextResponse.json({ ok: true, message, fallback: false })
  } catch (error: any) {
    const reason = typeof error?.message === 'string' ? error.message : 'intro_failed'
    return NextResponse.json({ ok: true, message: fallbackMessage, fallback: true, reason })
  }
}
