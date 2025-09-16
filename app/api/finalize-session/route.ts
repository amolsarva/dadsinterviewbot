import { NextRequest, NextResponse } from 'next/server'
import { list } from '@vercel/blob'
import { putBlobFromBuffer } from '@/lib/blob'
import { sendSummaryEmail } from '@/lib/email'
import { z } from 'zod'

type TurnSummary = {
  turn: number
  audio: string | null
  manifest: string
  transcript: string
  durationMs: number
  createdAt: string | null
}

const schema = z.object({
  sessionId: z.string().min(1),
  email: z.string().email().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sessionId, email } = schema.parse(body)

    const prefix = `sessions/${sessionId}/`
    const { blobs } = await list({ prefix, limit: 2000 })
    const turnBlobs = blobs
      .filter((b) => /turn-\d+\.json$/.test(b.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname))

    const turns: TurnSummary[] = []
    let totalDuration = 0
    let startedAt: string | null = null
    let endedAt: string | null = null

    for (const blob of turnBlobs) {
      try {
        const resp = await fetch(blob.url)
        const json = await resp.json()
        const turnNumber = Number(json.turn) || 0
        const transcript = typeof json.transcript === 'string' ? json.transcript : ''
        const created = json.createdAt || blob.uploadedAt || null
        if (created) {
          if (!startedAt || created < startedAt) startedAt = created
          if (!endedAt || created > endedAt) endedAt = created
        }
        const duration = Number(json.durationMs) || 0
        totalDuration += duration
        turns.push({
          turn: turnNumber,
          audio: json.userAudioUrl || null,
          manifest: blob.url,
          transcript: transcript.slice(0, 160),
          durationMs: duration,
          createdAt: created,
        })
      } catch {
        // Skip malformed turn entries but continue processing others
      }
    }

    const manifest = {
      sessionId,
      email: email || null,
      startedAt,
      endedAt,
      totals: { turns: turns.length, durationMs: totalDuration },
      turns: turns.map((t) => ({
        turn: t.turn,
        audio: t.audio,
        manifest: t.manifest,
        transcript: t.transcript,
        durationMs: t.durationMs,
        createdAt: t.createdAt,
      })),
    }

    const manifestUrl = (
      await putBlobFromBuffer(
        `sessions/${sessionId}/session-${sessionId}.json`,
        Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
        'application/json'
      )
    ).url

    let emailStatus: Awaited<ReturnType<typeof sendSummaryEmail>> | { skipped: true }
    emailStatus = { skipped: true }

    if (email) {
      const lines = turns
        .map((t) => `Turn ${t.turn}: ${t.transcript || '[no transcript]'}\nAudio: ${t.audio || 'unavailable'}\nManifest: ${t.manifest}`)
        .join('\n\n')
      const bodyParts = ['Your session is finalized. Here are your links.', `Session manifest: ${manifestUrl}`]
      if (lines) {
        bodyParts.push('', lines)
      }
      const bodyText = bodyParts.filter((part) => typeof part === 'string' && part.length).join('\n')
      try {
        emailStatus = await sendSummaryEmail(email, "Dad's Interview Bot - Session Summary", bodyText)
      } catch (e: any) {
        emailStatus = { ok: false, provider: 'unknown', error: e?.message || 'send_failed' }
      }
    }

    return NextResponse.json({
      ok: true,
      manifestUrl,
      totalTurns: turns.length,
      totalDurationMs: totalDuration,
      emailStatus,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'finalize_failed' }, { status: 400 })
  }
}
