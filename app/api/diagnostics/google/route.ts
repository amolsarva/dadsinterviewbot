import { NextResponse } from 'next/server'
import { resolveGoogleModel } from '@/lib/google'

export const runtime = 'nodejs'

const DEFAULT_MODEL = resolveGoogleModel(
  process.env.GOOGLE_DIAGNOSTICS_MODEL,
  process.env.GOOGLE_MODEL,
)

function extractReplyText(payload: any): string {
  if (!payload) return ''
  try {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
      const text = parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .filter((value: string) => Boolean(value && value.trim().length))
        .join('\n')
      if (text.trim().length) {
        return text.trim()
      }
    }
  } catch {}
  return ''
}

export async function GET() {
  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json({ ok: false, error: 'missing_api_key' }, { status: 503 })
  }

  const model = DEFAULT_MODEL
  const prompt = 'Reply with a short confirmation that the Google diagnostics check succeeded.'

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        cache: 'no-store',
      },
    )

    const json = await response.json().catch(() => ({}))
    const reply = extractReplyText(json)

    if (!response.ok) {
      const message =
        typeof json?.error?.message === 'string'
          ? json.error.message
          : typeof json?.error === 'string'
          ? json.error
          : response.statusText || 'Request failed'

      return NextResponse.json(
        {
          ok: false,
          status: response.status,
          message,
          model: { name: model },
        },
        { status: response.status >= 400 ? response.status : 502 },
      )
    }

    return NextResponse.json({
      ok: true,
      status: response.status,
      model: { name: model },
      reply,
    })
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : 'google_diagnostics_failed'
    return NextResponse.json(
      { ok: false, error: message, status: null, model: { name: model } },
      { status: 500 },
    )
  }
}
