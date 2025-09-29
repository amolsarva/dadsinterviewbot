import { NextResponse } from 'next/server'
import { resolveGoogleModel } from '@/lib/google-model'

export const runtime = 'nodejs'

const MODEL = resolveGoogleModel(process.env.GOOGLE_MODEL)

export async function GET() {
  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json({
      ok: false,
      error: 'missing_google_key',
      message: 'GOOGLE_API_KEY is not configured.',
    })
  }

  const model = MODEL
  const endpointPath = `v1beta/models/${model}:generateContent`
  const url = `https://generativelanguage.googleapis.com/${endpointPath}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GOOGLE_API_KEY || '',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Reply with OK.' }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8,
        },
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message =
        typeof data?.error?.message === 'string'
          ? data.error.message
          : typeof data?.error === 'string'
          ? data.error
          : response.statusText || 'Google AI request failed.'
      return NextResponse.json(
        {
          ok: false,
          error: 'google_request_failed',
          message,
          status: response.status,
          details: data?.error ?? null,
          endpoint: 'models.generateContent',
          requestPath: endpointPath,
          requestUrl: url,
          model,
        },
        { status: response.status || 200 },
      )
    }

    const candidate = data?.candidates?.[0] || {}
    const reply =
      candidate?.content?.parts?.map((part: any) => part?.text || '').filter(Boolean).join('\n') || ''

    return NextResponse.json({
      ok: true,
      model: {
        name: candidate?.model || data?.model || model,
        version: data?.modelVersion || candidate?.modelVersion || null,
      },
      reply,
      finishReason: candidate?.finishReason || null,
      safety: candidate?.safetyRatings || data?.safetyRatings || null,
      endpoint: 'models.generateContent',
      requestPath: endpointPath,
      requestUrl: url,
    })
  } catch (err: any) {
    const message = typeof err?.message === 'string' ? err.message : 'Google AI request failed.'
    return NextResponse.json(
      {
        ok: false,
        error: 'google_request_failed',
        message,
        status: null,
        endpoint: 'models.generateContent',
        requestPath: endpointPath,
        requestUrl: url,
        model,
      },
      { status: 200 },
    )
  }
}
