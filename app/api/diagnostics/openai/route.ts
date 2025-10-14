import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { jsonErrorResponse } from '@/lib/api-error'

export const runtime = 'nodejs'

const DEFAULT_MODEL = process.env.OPENAI_DIAGNOSTICS_MODEL || 'gpt-4o-mini'

function extractErrorMessage(error: any): string {
  if (!error) return 'openai_diagnostics_failed'
  if (typeof error?.error?.message === 'string') return error.error.message
  if (typeof error?.response?.data?.error?.message === 'string') return error.response.data.error.message
  if (typeof error?.response?.data?.error === 'string') return error.response.data.error
  if (typeof error?.message === 'string') return error.message
  return 'openai_diagnostics_failed'
}

function extractStatus(error: any): number {
  if (!error) return 500
  if (typeof error?.status === 'number') return error.status
  if (typeof error?.response?.status === 'number') return error.response.status
  return 500
}

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, error: 'missing_api_key' }, { status: 503 })
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = DEFAULT_MODEL

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are verifying connectivity for diagnostics.' },
        { role: 'user', content: 'Reply with a brief confirmation that OpenAI connectivity works.' },
      ],
      max_tokens: 60,
    })

    const reply = completion.choices?.[0]?.message?.content?.trim() || ''

    return NextResponse.json({
      ok: true,
      status: 200,
      model: { id: completion.model || model },
      reply,
    })
  } catch (error) {
    const status = extractStatus(error)
    const message = extractErrorMessage(error)
    return jsonErrorResponse(error, message, status >= 400 ? status : 502, {
      status,
      error: message,
    })
  }
}
