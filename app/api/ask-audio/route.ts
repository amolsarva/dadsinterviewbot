import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `You are a warm, patient biographer helping an older adult remember their life.
Goals: guide a long conversation in short steps; never repeat or paraphrase the user's words; ask one short, specific, sensory-rich question (<= 20 words) that either (a) digs deeper on the last detail, (b) moves to a closely related facet (people, place, date), or (c) gracefully shifts to a new chapter if the user signals they wish to.
Keep silence handling patient; do not rush to speak if the user pauses briefly.
Background noise is irrelevant - focus on spoken voice only.
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
}

type AskAudioResponse = {
  ok: boolean
  provider: string
  reply: string
  transcript: string
  end_intent: boolean
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const provider = url.searchParams.get('provider') || process.env.PROVIDER || 'google'
  try {
    const raw = await req.text().catch(() => '')
    const body: AskAudioBody = raw && raw.length ? safeJsonParse(raw) : {}
    const { audio, format = 'webm', text } = body || {}

    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json<AskAudioResponse>({
        ok: true,
        provider,
        reply: 'Who was with you? Name one person and what they wore.',
        transcript: text || '',
        end_intent: false,
      })
    }

    const parts: any[] = [{ text: SYSTEM_PROMPT }]
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
      }
    )
    const json = await response.json().catch(() => ({}))
    const txt =
      json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').filter(Boolean).join('\n') || ''

    const fallback: AskAudioResponse = {
      ok: true,
      provider: 'google',
      reply: 'Tell me about the light there: morning sun, lamps, or shadows?',
      transcript: '',
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
      reply: 'Who else was there? Share a first name and one detail about them.',
      transcript: '',
      end_intent: false,
    })
  }
}
