import { NextRequest, NextResponse } from 'next/server'
import { ensureSessionMemoryHydrated, getMemoryPrimer, getSessionMemorySnapshot } from '@/lib/data'
import {
  collectAskedQuestions,
  findLatestUserDetails,
  normalizeQuestion,
  pickFallbackQuestion,
} from '@/lib/question-memory'
import { detectCompletionIntent } from '@/lib/intents'

const SYSTEM_PROMPT = `You are a warm, curious biographer inspired by the book “The Essential Questions”, but you are not following a rigid script.
You remember every conversation provided in the memory section below.
Principles:
- Follow the user's lead and respond directly to any instruction, question, or aside before you consider another prompt.
- Be open to any topic the user brings up, gently weaving the discussion back toward the life-story themes when it feels natural.
- Never repeat or paraphrase the user's own words, and do not repeat questions listed in the memory section.
- Quickly summarize what you hear in each response before speaking further.
- If a reply is brief or uncertain, adapt by changing angles or suggesting a different avenue instead of insisting on the same question.
- Ask at most one short, specific, open-ended question (<= 20 words) only when the user seems ready to keep going.
- Keep silence handling patient; do not rush to speak if the user pauses briefly.
- If the user signals they are finished for now, set end_intent to true and close warmly without pushing another question. Say you are happy to talk more later.
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
  primerText: string
}

function softenQuestion(question: string | null | undefined): string {
  if (!question) return ''
  const trimmed = question.trim()
  if (!trimmed.length) return ''
  const withoutQuestion = trimmed.replace(/[?]+$/, '')
  const lowered = withoutQuestion.charAt(0).toLowerCase() + withoutQuestion.slice(1)
  return `If you'd like, you could share ${lowered}.`
}

async function buildMemoryPrompt(sessionId: string | undefined): Promise<MemoryPrompt> {
  if (!sessionId) {
    return {
      historyText: 'No session memory is available yet.',
      questionText: 'No prior questions are on record.',
      recentConversation: '',
      askedQuestions: [],
      primerText: '',
    }
  }

  const { current, sessions } = getSessionMemorySnapshot(sessionId)
  const askedQuestions = collectAskedQuestions(sessions)
  const detailForFallback = findLatestUserDetails(sessions, { limit: 1 })[0]
  const primer = await getMemoryPrimer()
  const primerText = primer.text ? primer.text.trim() : ''

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
    primerText,
  }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') || process.env.PROVIDER || 'google'
  try {
    const raw = await req.text().catch(() => '')
    const body: AskAudioBody = raw && raw.length ? safeJsonParse(raw) : {}
    const { audio, format = 'webm', text, sessionId } = body || {}

    if (sessionId) {
      await ensureSessionMemoryHydrated().catch(() => undefined)
    }
    const memory = await buildMemoryPrompt(sessionId)
    const fallbackQuestion = pickFallbackQuestion(memory.askedQuestions, memory.detailForFallback)
    const fallbackSuggestion = softenQuestion(fallbackQuestion)
    const fallbackReply = memory.detailForFallback
      ? `I remember you mentioned ${memory.detailForFallback}. We can stay with that or wander somewhere entirely new—whatever feels right to you.${
          fallbackSuggestion ? ` ${fallbackSuggestion}` : ''
        }`
      : `I'm here with you and happy to talk about anything on your mind.${
          fallbackSuggestion ? ` ${fallbackSuggestion}` : ' If you’d like a prompt, I can offer one whenever you choose.'
        }`

    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json<AskAudioResponse>({
        ok: true,
        provider,
        reply: fallbackReply,
        transcript: text || '',
        end_intent: detectCompletionIntent(text || '').shouldStop,
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
      reply: fallbackReply,
      transcript: text || '',
      end_intent: detectCompletionIntent(text || '').shouldStop,
    }

    try {
      const cleaned = txt.trim().replace(/^```(json)?/i, '').replace(/```$/i, '')
      const parsed = JSON.parse(cleaned)
      let reply = parsed.reply || fallback.reply
      if (reply) {
        const normalized = normalizeQuestion(reply)
        if (normalized && memory.askedQuestions.some((question) => normalizeQuestion(question) === normalized)) {
          reply = fallbackReply
        }
      }
      const transcriptText = typeof parsed.transcript === 'string' ? parsed.transcript : fallback.transcript || ''
      const completion = detectCompletionIntent(transcriptText || text || '')
      return NextResponse.json({
        ok: true,
        provider: 'google',
        reply,
        transcript: transcriptText,
        end_intent: Boolean(parsed.end_intent) || completion.shouldStop,
      })
    } catch {
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
      })
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
