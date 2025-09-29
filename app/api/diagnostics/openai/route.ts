import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      ok: false,
      error: 'missing_openai_key',
      message: 'OPENAI_API_KEY is not configured.',
    })
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = DEFAULT_MODEL

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are a diagnostics probe. Reply with OK.' },
        { role: 'user', content: 'Respond with OK.' },
      ],
      max_tokens: 8,
      temperature: 0,
    })

    const reply = completion.choices?.[0]?.message?.content?.trim() || ''

    return NextResponse.json({
      ok: true,
      model: { id: completion.model },
      reply,
      usage: completion.usage || null,
      finishReason: completion.choices?.[0]?.finish_reason || null,
      endpoint: 'chat.completions',
    })
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : null
    const message =
      typeof err?.message === 'string'
        ? err.message
        : typeof err?.error?.message === 'string'
        ? err.error.message
        : 'OpenAI request failed.'
    const details = err?.error ?? null

    return NextResponse.json(
      {
        ok: false,
        error: 'openai_request_failed',
        message,
        status,
        details,
        endpoint: 'chat.completions',
        model,
      },
      { status: status && status >= 400 ? status : 200 },
    )
  }
}
