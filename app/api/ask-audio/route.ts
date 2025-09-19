import { NextRequest, NextResponse } from 'next/server'
import type { Session, Turn } from '@/lib/data'
import { getSession, listSessions } from '@/lib/data'

const ESSENTIAL_QUESTION_SECTIONS: { title: string; questions: string[] }[] = [
  {
    title: 'Intro / Warm-ups',
    questions: [
      'Tell me about where and when you were born. What was the neighborhood like?',
      'Who were the people in your childhood home? What routines do you remember?',
      'What games or pastimes did you love as a child?',
    ],
  },
  {
    title: 'Youth and Formative Years',
    questions: [
      'What was school like for you? Describe teachers, classmates, or the building.',
      'Who were your close friends? What did you do together?',
      'What did you hope to become when you were young? Did that change?',
    ],
  },
  {
    title: 'Young Adulthood & Transitions',
    questions: [
      'How did you spend your time in young adulthood—jobs, relationships, moves?',
      'How did you meet a significant friend or partner? What was that like?',
      'Did you leave home? Tell me about that experience.',
    ],
  },
  {
    title: 'Work, Family & Midlife',
    questions: [
      'Describe your first job and how your work life unfolded.',
      'What was it like raising children or caring for family?',
      'What traditions or cultural practices did your household keep?',
    ],
  },
  {
    title: 'Later Years & Reflection',
    questions: [
      'What moments or achievements are you most proud of?',
      'What challenges shaped you, and how did you move through them?',
      'How have your beliefs or values changed over time?',
    ],
  },
  {
    title: 'Memory, Place, and Sense of Self',
    questions: [
      'Describe a place from your past that still lives in your memory—what do you see, hear, or smell?',
      'Are there objects or keepsakes that hold deep meaning for you? Why?',
      'Recall a vivid moment of joy, fear, or wonder—what happened?',
    ],
  },
  {
    title: 'Culture, Change, and the World',
    questions: [
      'How has the world changed since you were young? Which changes felt good or hard?',
      'How have your cultural traditions evolved across your life?',
      'How has aging influenced how you see yourself?',
    ],
  },
  {
    title: 'Closing / Legacy',
    questions: [
      'Is there a story you wish people asked you about more often?',
      'What would you like your family or community to remember about you?',
      'Is there anything we have not covered that you want to share before we finish?',
    ],
  },
]

const ESSENTIAL_QUESTION_LIST = ESSENTIAL_QUESTION_SECTIONS.flatMap((section) => section.questions)
const ESSENTIAL_GUIDE_TEXT = ESSENTIAL_QUESTION_SECTIONS.map(
  (section) => `${section.title}:\n- ${section.questions.join('\n- ')}`,
).join('\n\n')

const SYSTEM_PROMPT_BASE = `You are a warm, patient biographer helping an older adult remember their life.
Goals: guide a long conversation in short steps; never repeat or paraphrase the user's words; ask one short, specific, sensory-rich question (<= 20 words) that either (a) digs deeper on the last detail, (b) moves to a closely related facet (people, place, date), or (c) gracefully shifts to a new chapter if the user signals they wish to.
Always prioritize and quote the user's latest words from the audio you receive. Use older transcripts only as gentle background context.
You have an interview guide called "Essential Questions" with the topic areas listed below; consult it to choose the next prompt that best extends the conversation.
If previous interviews exist, gracefully acknowledge continuity (for example, "Last time we talked about...") before moving forward. If this is the first session, begin with a gentle warm-up from the guide.
Keep silence handling patient; do not rush to speak if the user pauses briefly.
Background noise is irrelevant - focus on spoken voice only.
You will receive stored transcripts after this message. Use them to determine whether we are resuming a prior thread.
If the user signals they are finished ("I'm finished", "that's all", etc.), set "end_intent" to true and reply with a brief acknowledgement before wrapping up.
Return a JSON object:{"reply":"...", "transcript":"...", "end_intent":true|false}.`

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
  mime?: string
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

type InterviewContext = {
  previousSummary: string
  currentSummary: string
  hasPrevious: boolean
}

function clamp(text: string, max = 240) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

function formatTurnLines(turns: Turn[] | undefined, limit: number) {
  if (!turns || !turns.length) return []
  const lines: string[] = []
  for (const turn of turns) {
    if (!turn || typeof turn.text !== 'string') continue
    const role = turn.role === 'assistant' ? 'Assistant' : 'User'
    const trimmed = clamp(turn.text)
    if (trimmed) lines.push(`${role}: ${trimmed}`)
  }
  return lines.slice(-limit)
}

function formatSessionSummary(session: Session, limit: number) {
  const when = (() => {
    if (!session?.created_at) return 'Unknown date'
    const d = new Date(session.created_at)
    if (Number.isNaN(d.getTime())) return session.created_at
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  })()
  const lines = formatTurnLines(session.turns, limit)
  if (!lines.length) return ''
  const title = session.title ? clamp(session.title, 80) : null
  const label = title ? `${when} — ${title}` : when
  return `${label}\n${lines.join('\n')}`
}

async function buildInterviewContext(sessionId?: string): Promise<InterviewContext> {
  let sessions: Session[] = []
  try {
    sessions = await listSessions()
  } catch {
    sessions = []
  }

  let current: Session | undefined
  if (sessionId) {
    current = sessions.find((s) => s.id === sessionId)
    if (!current) {
      try {
        current = await getSession(sessionId) || undefined
      } catch {
        current = undefined
      }
    }
  }

  const previousSessions = sessions
    .filter((s) => s.id !== sessionId && s.turns && s.turns.length)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const previousSummary = previousSessions
    .slice(-3)
    .map((session) => formatSessionSummary(session, 8))
    .filter((block) => block.length)
    .join('\n\n')

  const currentSummary = current ? formatSessionSummary(current, 12) : ''

  return {
    previousSummary,
    currentSummary,
    hasPrevious: previousSessions.length > 0,
  }
}

function buildSystemPrompt(context: InterviewContext, turn?: number) {
  const guideText = ESSENTIAL_GUIDE_TEXT
  const turnInfo = Number.isFinite(turn) ? `We are on turn ${turn}.` : 'Start of session.'
  const continuity = context.hasPrevious
    ? 'Stored interviews exist. Acknowledge what was covered previously before moving forward.'
    : 'No stored interviews were found. Treat this as a brand new conversation unless the user says otherwise.'
  return `${SYSTEM_PROMPT_BASE}\n\n${turnInfo}\n${continuity}\n\nEssential Questions guide:\n${guideText}`
}

function buildContextBlock(context: InterviewContext) {
  const sections: string[] = []
  if (context.previousSummary) {
    sections.push(`Previous interviews summary (oldest to newest):\n${context.previousSummary}`)
  } else {
    sections.push('No previous interview transcripts were available.')
  }
  if (context.currentSummary) {
    sections.push(`Current session so far (do not repeat verbatim):\n${context.currentSummary}`)
  }
  return sections.join('\n\n')
}

function pickFallbackQuestion(turn?: number) {
  if (!ESSENTIAL_QUESTION_LIST.length) {
    return 'Tell me about where and when you were born. What was the neighborhood like?'
  }
  const index = typeof turn === 'number' && turn > 0 ? (turn - 1) % ESSENTIAL_QUESTION_LIST.length : 0
  return ESSENTIAL_QUESTION_LIST[index]
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') || process.env.PROVIDER || 'google'
  try {
    const raw = await req.text().catch(() => '')
    const body: AskAudioBody = raw && raw.length ? safeJsonParse(raw) : {}
    const { audio, format = 'webm', mime, text, sessionId, turn } = body || {}

    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json<AskAudioResponse>({
        ok: true,
        provider,
        reply: pickFallbackQuestion(turn),
        transcript: text || '',
        end_intent: false,
      })
    }

    const context = await buildInterviewContext(sessionId)
    const systemPrompt = buildSystemPrompt(context, turn)
    const contextBlock = buildContextBlock(context)

    const parts: any[] = [{ text: systemPrompt }]
    if (contextBlock) {
      parts.push({ text: contextBlock })
    }
    if (audio) {
      const effectiveMime = typeof mime === 'string' && mime ? mime : `audio/${format}`
      parts.push({ inlineData: { mimeType: effectiveMime, data: audio } })
    }
    if (text) parts.push({ text })
    parts.push({ text: 'Return JSON: {"reply":"...","transcript":"...","end_intent":false}' })

    const model = process.env.GOOGLE_MODEL || 'gemini-1.5-flash'
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
      }
    )
    const json = await response.json().catch(() => ({}))
    const txt =
      json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').filter(Boolean).join('\n') || ''

    const fallback: AskAudioResponse = {
      ok: true,
      provider: 'google',
      reply: pickFallbackQuestion(turn),
      transcript: text || '',
      end_intent: false,
    }

    try {
      const cleaned = txt.trim().replace(/^```(json)?/, '').replace(/```$/, '')
      const parsed = JSON.parse(cleaned)
      return NextResponse.json({
        ok: true,
        provider: 'google',
        reply: parsed.reply || fallback.reply,
        transcript: parsed.transcript || fallback.transcript,
        end_intent: Boolean(parsed.end_intent),
      })
    } catch {
      return NextResponse.json({ ...fallback, reply: txt || fallback.reply })
    }
  } catch (e) {
    return NextResponse.json<AskAudioResponse>({
      ok: true,
      provider,
      reply: pickFallbackQuestion(),
      transcript: '',
      end_intent: false,
    })
  }
}
