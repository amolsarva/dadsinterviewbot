import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { primeNetlifyBlobContextFromHeaders, putBlobFromBuffer } from '@/lib/blob'
import { mergeSessionArtifacts } from '@/lib/data'

const schema = z.object({
  sessionId: z.string().min(1),
  audio: z.string().min(1),
  mime: z.string().default('audio/webm'),
  duration_ms: z.number().nonnegative().optional(),
})

export async function POST(request: NextRequest) {
  primeNetlifyBlobContextFromHeaders((request as NextRequest | undefined)?.headers)
  try {
    const body = await request.json()
    const { sessionId, audio, mime, duration_ms } = schema.parse(body)

    const buffer = Buffer.from(audio, 'base64')
    const ext = mime.split('/')[1]?.split(';')[0] || 'webm'
    const blob = await putBlobFromBuffer(
      `sessions/${sessionId}/session-audio.${ext}`,
      buffer,
      mime,
      { access: 'public' },
    )

    const url = blob.downloadUrl || blob.url

    mergeSessionArtifacts(sessionId, {
      artifacts: { session_audio: url },
      durationMs: typeof duration_ms === 'number' ? duration_ms : undefined,
    })

    return NextResponse.json({ ok: true, url, durationMs: duration_ms ?? null })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'save_failed' }, { status: 400 })
  }
}
