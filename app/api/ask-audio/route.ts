import { NextRequest, NextResponse } from 'next/server'
import { getSessionMemorySnapshot } from '@/lib/data'
import {
  collectAskedQuestions,
  findLatestUserDetails,
  normalizeQuestion,
  pickFallbackQuestion,
} from '@/lib/question-memory'

const SYSTEM_PROMPT = `You are a warm, patient biographer helping an older adult remember their life.
You remember every conversation provided in the memory section below.
Goals: guide a long conversation in short steps; never repeat or paraphrase the user's words; ask one short, specific, sensory-rich question (<= 20 words) that either (a) digs deeper on the last detail, (b) moves to a closely related facet (people, place, date), or (c) gracefully shifts to a new chapter if the user signals they wish to.
Keep silence handling patient; do not rush to speak if the user pauses briefly.
Background noise is irrelevant - focus on spoken voice only.
Do not repeat any question that appears in the memory section.
Return a JSON object: {"reply":"...", "transcript":"...", "end_intent":true|false}.`

function safeJsonParse(input: string | null | undefined) {
  if (!input) return {}
  try {
    return JSON.parse(input)
  } catch {
    return {}
  }
}

type AskAudioBody = {
  audio?: string
  format?: string
  text?: string
  sessionId?: string
  turn?: number
}

type AskAudioResponse = {
  ok: boolean
  provider: string
  reply: string
  transcript: string
  end_intent: boolean
}

type MemoryPrompt = {
  historyText: string
  questionText: string
  recentConversation: string
  askedQuestions: string[]
  detailForFallback?: string
}

function buildMemoryPrompt(sessionId: string | undefined): MemoryPrompt {
  if (!sessionId) {
    return {
      historyText: 'No session memory is available yet.',
      questionText: 'No prior questions are on record.',
      recentConversation: '',
      askedQuestions: [],
    }
  }

  const { current, sessions } = getSessionMemorySnapshot(sessionId)
  const askedQuestions = collectAskedQuestions(sessions)
  const detailForFallback = findLatestUserDetails(sessions, { limit: 1 })[0]

  const historyLines: string[] = []
  const priorSessions = sessions.filter((session) => session.id !== sessionId)
  if (priorSessions.length) {
    historyLines.push('Highlights from previous sessions:')
    for (const session of priorSessions.slice(0, 4)) {
      const title = session.title ? session.title : `Session from ${new Date(session.created_at).toLocaleDateString()}`
      const recentDetail = findLatestUserDetails([session], { limit: 1 })[0]
      historyLines.push(`- ${title}${recentDetail ? ` → ${recentDetail}` : ''}`)
    }
  }

  const conversationLines: string[] = []
  if (current && current.turns.length) {
    conversationLines.push('Current session so far:')
    for (const turn of current.turns.slice(-6)) {
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

  return {
    historyText: historyLines.length ? historyLines.join('\n') : 'No previous transcript details are available yet.',
    questionText: questionLines.join('\n'),
    recentConversation: conversationLines.join('\n'),
    askedQuestions,
    detailForFallback,
  }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') || process.env.PROVIDER || 'google'
  try {
    const raw = await req.text().catch(() => '')
    const body: AskAudioBody = raw && raw.length ? safeJsonParse(raw) : {}
    const { audio, format = 'webm', text, sessionId } = body || {}

    const memory = buildMemoryPrompt(sessionId)
    const fallbackQuestion = pickFallbackQuestion(memory.askedQuestions, memory.detailForFallback)

    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json<AskAudioResponse>({
        ok: true,
        provider,
        reply: fallbackQuestion,
        transcript: text || '',
        end_intent: false,
      })
    }

    const parts: any[] = [{ text: SYSTEM_PROMPT }, { text: memory.historyText }, { text: memory.questionText }]
    if (memory.recentConversation) {
      parts.push({ text: memory.recentConversation })
    }
    if (audio) parts.push({ inlineData: { mimeType: `audio/${format}`, data: audio } })
    if (text) parts.push({ text })
    parts.push({ text: 'Return JSON: {"reply":"...","transcript":"...","end_intent":false}' })

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
      reply: fallbackQuestion,
      transcript: '',
      end_intent: false,
    }

    try {
      const cleaned = txt.trim().replace(/^```(json)?/i, '').replace(/```$/i, '')
      const parsed = JSON.parse(cleaned)
      let reply = parsed.reply || fallback.reply
      if (reply) {
        const normalized = normalizeQuestion(reply)
        if (normalized && memory.askedQuestions.some((question) => normalizeQuestion(question) === normalized)) {
          reply = fallbackQuestion
        }
      }
      return NextResponse.json({
        ok: true,
        provider: 'google',
        reply,
        transcript: parsed.transcript || fallback.transcript || '',
        end_intent: Boolean(parsed.end_intent),
      })
    } catch {
      const normalized = normalizeQuestion(txt)
      if (normalized && memory.askedQuestions.some((question) => normalizeQuestion(question) === normalized)) {
        return NextResponse.json(fallback)
      }
      return NextResponse.json({ ...fallback, reply: txt || fallback.reply })
    }
  } catch (e) {
    return NextResponse.json<AskAudioResponse>({
      ok: true,
      provider,
      reply: 'Who else was there? Share a first name and one detail about them.',
      transcript: '',
      end_intent: false,
    })
  }
}
