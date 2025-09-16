import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { putBlobFromBuffer } from '@/lib/blob'

const schema = z.object({
  sessionId: z.string().min(1),
  turn: z.union([z.number().int(), z.string()]),
  wav: z.string().min(1),
  mime: z.string().default('audio/webm'),
  duration_ms: z.union([z.number(), z.string()]).default(0),
  reply_text: z.string().default(''),
  transcript: z.string().default(''),
  provider: z.string().default('google'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.parse(body)

    const turnNumber = typeof parsed.turn === 'string' ? Number(parsed.turn) : parsed.turn
    if (!Number.isFinite(turnNumber) || turnNumber <= 0) {
      throw new Error('Invalid turn number')
    }

    const buffer = Buffer.from(parsed.wav, 'base64')
    const pad = String(turnNumber).padStart(4, '0')
    const mime = parsed.mime || 'audio/webm'
    const extGuess = mime.split('/')[1]?.split(';')[0] || 'webm'
    const audioPath = `sessions/${parsed.sessionId}/user-${pad}.${extGuess}`
    const manifestPath = `sessions/${parsed.sessionId}/turn-${pad}.json`

    const userAudio = await putBlobFromBuffer(audioPath, buffer, mime)
    const manifestBody = {
      sessionId: parsed.sessionId,
      turn: turnNumber,
      createdAt: new Date().toISOString(),
      durationMs: Number(parsed.duration_ms) || 0,
      userAudioUrl: userAudio.url,
      transcript: parsed.transcript,
      assistantReply: parsed.reply_text,
      provider: parsed.provider,
      endIntent: false,
    }
    const manifest = await putBlobFromBuffer(
      manifestPath,
      Buffer.from(JSON.stringify(manifestBody, null, 2), 'utf8'),
      'application/json'
    )

    return NextResponse.json({ ok: true, userAudioUrl: userAudio.url, manifestUrl: manifest.url })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'save_failed' }, { status: 400 })
  }
}
