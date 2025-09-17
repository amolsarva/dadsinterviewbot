import { NextRequest, NextResponse } from 'next/server'
import { list } from '@vercel/blob'
import { putBlobFromBuffer } from '@/lib/blob'
import { sendSummaryEmail } from '@/lib/email'
import { getSession } from '@/lib/data'
import { z } from 'zod'

type TurnSummary = {
  turn: number
  audio: string | null
  manifest: string
  transcript: string
  assistantReply: string
  durationMs: number
  createdAt: string | null
  provider?: string
}

const schema = z.object({
  sessionId: z.string().min(1),
  email: z.string().email().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sessionId, email } = schema.parse(body)

    const token = process.env.VERCEL_BLOB_READ_WRITE_TOKEN
    let turnBlobs: Awaited<ReturnType<typeof list>>['blobs'] = []
    if (token) {
      try {
        const prefix = `sessions/${sessionId}/`
        const listed = await list({ prefix, limit: 2000, token })
        turnBlobs = listed.blobs.filter((b) => /turn-\d+\.json$/.test(b.pathname))
        turnBlobs.sort((a, b) => a.pathname.localeCompare(b.pathname))
      } catch (err) {
        console.warn('Failed to list blob turns', err)
      }
    }

    const turns: TurnSummary[] = []
    let totalDuration = 0
    let startedAt: string | null = null
    let endedAt: string | null = null

    if (turnBlobs.length) {
      for (const blob of turnBlobs) {
        try {
          const resp = await fetch(blob.downloadUrl || blob.url)
          const json = await resp.json()
          const turnNumber = Number(json.turn) || 0
          const transcript = typeof json.transcript === 'string' ? json.transcript : ''
          const assistantReply = typeof json.assistantReply === 'string' ? json.assistantReply : ''
          const createdRaw = json.createdAt || blob.uploadedAt || null
          const created =
            typeof createdRaw === 'string'
              ? createdRaw
              : createdRaw instanceof Date
              ? createdRaw.toISOString()
              : null
          if (created) {
            if (!startedAt || created < startedAt) startedAt = created
            if (!endedAt || created > endedAt) endedAt = created
          }
          const duration = Number(json.durationMs) || 0
          totalDuration += duration
          turns.push({
            turn: turnNumber,
            audio: json.userAudioUrl || null,
            manifest: blob.downloadUrl || blob.url,
            transcript,
            assistantReply,
            durationMs: duration,
            createdAt: created,
            provider: typeof json.provider === 'string' ? json.provider : undefined,
          })
        } catch (err) {
          console.warn('Failed to parse turn manifest', err)
          // Skip malformed turn entries but continue processing others
        }
      }
    }

    if (!turns.length) {
      const inMemory = await getSession(sessionId)
      if (inMemory?.turns?.length) {
        let currentTurn = 0
        for (const entry of inMemory.turns) {
          if (entry.role === 'user') {
            currentTurn += 1
            turns.push({
              turn: currentTurn,
              audio: entry.audio_blob_url || null,
              manifest: '',
              transcript: entry.text,
              assistantReply: '',
              durationMs: 0,
              createdAt: inMemory.created_at,
            })
          } else if (entry.role === 'assistant') {
            const target = turns.find((t) => t.turn === currentTurn)
            if (target) {
              target.assistantReply = entry.text
            } else {
              turns.push({
                turn: currentTurn,
                audio: null,
                manifest: '',
                transcript: '',
                assistantReply: entry.text,
                durationMs: 0,
                createdAt: inMemory.created_at,
              })
            }
          }
        }
        totalDuration = inMemory.duration_ms || 0
        startedAt = inMemory.created_at
        endedAt = inMemory.created_at
      }
    }

    turns.sort((a, b) => a.turn - b.turn)

    const conversationLines: { role: 'user' | 'assistant'; text: string; turn: number; audio?: string | null }[] = []
    for (const entry of turns) {
      if (entry.transcript) {
        conversationLines.push({ role: 'user', text: entry.transcript, turn: entry.turn, audio: entry.audio })
      }
      if (entry.assistantReply) {
        conversationLines.push({ role: 'assistant', text: entry.assistantReply, turn: entry.turn })
      }
    }

    const transcriptText = conversationLines
      .filter((line) => line.text)
      .map((line) => `${line.role === 'user' ? 'User' : 'Assistant'} (turn ${line.turn}): ${line.text}`)
      .join('\n')

    const transcriptJson = {
      sessionId,
      createdAt: startedAt,
      turns: conversationLines.map((line) => ({
        role: line.role,
        turn: line.turn,
        text: line.text,
        audio: line.audio || null,
      })),
    }

    const transcriptTxtUrl = (
      await putBlobFromBuffer(
        `sessions/${sessionId}/transcript-${sessionId}.txt`,
        Buffer.from(transcriptText, 'utf8'),
        'text/plain; charset=utf-8'
      )
    ).url
    const transcriptJsonUrl = (
      await putBlobFromBuffer(
        `sessions/${sessionId}/transcript-${sessionId}.json`,
        Buffer.from(JSON.stringify(transcriptJson, null, 2), 'utf8'),
        'application/json'
      )
    ).url

    const manifest = {
      sessionId,
      email: email || process.env.DEFAULT_NOTIFY_EMAIL || null,
      startedAt,
      endedAt,
      totals: { turns: turns.length, durationMs: totalDuration },
      turns: turns.map((t) => ({
        turn: t.turn,
        audio: t.audio,
        manifest: t.manifest,
        transcript: t.transcript,
        assistantReply: t.assistantReply,
        durationMs: t.durationMs,
        createdAt: t.createdAt,
        provider: t.provider,
      })),
      artifacts: {
        transcript_txt: transcriptTxtUrl,
        transcript_json: transcriptJsonUrl,
      },
    }

    const manifestUrl = (
      await putBlobFromBuffer(
        `sessions/${sessionId}/session-${sessionId}.json`,
        Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
        'application/json',
        { access: 'public' }
      )
    ).url

    let emailStatus: Awaited<ReturnType<typeof sendSummaryEmail>> | { skipped: true }
    emailStatus = { skipped: true }

    const targetEmail = email || process.env.DEFAULT_NOTIFY_EMAIL
    if (targetEmail) {
      const lines = turns
        .map(
          (t) =>
            `Turn ${t.turn}: ${t.transcript || '[no transcript]'}\nAssistant: ${t.assistantReply || '[no reply]'}\nAudio: ${
              t.audio || 'unavailable'
            }\nManifest: ${t.manifest || 'unavailable'}`
        )
        .join('\n\n')
      const bodyParts = [
        'Your session is finalized. Here are your links.',
        `Session manifest: ${manifestUrl}`,
        `Transcript (txt): ${transcriptTxtUrl}`,
        `Transcript (json): ${transcriptJsonUrl}`,
      ]
      if (lines) {
        bodyParts.push('', lines)
      }
      const bodyText = bodyParts.filter((part) => typeof part === 'string' && part.length).join('\n')
      try {
        emailStatus = await sendSummaryEmail(targetEmail, "Dad's Interview Bot - Session Summary", bodyText)
      } catch (e: any) {
        emailStatus = { ok: false, provider: 'unknown', error: e?.message || 'send_failed' }
      }
    }

    return NextResponse.json({
      ok: true,
      manifestUrl,
      totalTurns: turns.length,
      totalDurationMs: totalDuration,
      artifacts: { transcript_txt: transcriptTxtUrl, transcript_json: transcriptJsonUrl },
      emailStatus,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'finalize_failed' }, { status: 400 })
  }
}
