import { NextResponse } from 'next/server'
import { listSessions, clearAllSessions, deleteSessionsByHandle } from '@/lib/data'
import { fetchStoredSessions } from '@/lib/history'
import { generateSessionTitle, SummarizableTurn } from '@/lib/session-title'

function summarizeUserTurns<T extends { role: string; text?: string | null }>(
  turns: T[] | undefined,
): SummarizableTurn[] {
  if (!turns) return []
  return turns
    .filter((turn): turn is T & { text: string } => turn.role === 'user' && typeof turn.text === 'string')
    .map((turn) => ({ role: 'user' as const, text: turn.text }))
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const handle = url.searchParams.get('handle')

  const items = await listSessions(handle || undefined)
  const rows = items.map((session) => {
    const summarizableTurns = summarizeUserTurns(session.turns)

    return {
      id: session.id,
      created_at: session.created_at,
      title:
        session.title ||
        generateSessionTitle(summarizableTurns, {
          fallback: `Session on ${new Date(session.created_at).toLocaleDateString()}`,
        }) ||
        null,
      status: session.status,
      total_turns: session.total_turns,
      artifacts: {
        transcript_txt: session.artifacts?.transcript_txt || null,
        transcript_json: session.artifacts?.transcript_json || null,
        session_manifest: session.artifacts?.session_manifest || session.artifacts?.manifest || null,
        session_audio: session.artifacts?.session_audio || null,
      },
      manifestUrl: session.artifacts?.session_manifest || session.artifacts?.manifest || null,
      firstAudioUrl: session.turns?.find((turn) => Boolean(turn.audio_blob_url))?.audio_blob_url || null,
      sessionAudioUrl: session.artifacts?.session_audio || null,
    }
  })

  const { items: stored } = await fetchStoredSessions({ limit: 50, handle: handle || undefined })
  for (const storedSession of stored) {
    if (rows.some((row) => row.id === storedSession.sessionId)) continue

    const summarizableTurns: SummarizableTurn[] = (storedSession.turns || [])
      .filter((turn) => typeof turn?.transcript === 'string')
      .map((turn) => ({ role: 'user' as const, text: turn.transcript as string }))

    rows.push({
      id: storedSession.sessionId,
      created_at: storedSession.startedAt || storedSession.endedAt || new Date().toISOString(),
      title:
        generateSessionTitle(summarizableTurns, {
          fallback: `Session on ${
            new Date(
              storedSession.startedAt || storedSession.endedAt || new Date().toISOString(),
            ).toLocaleDateString()
          }`,
        }) ||
        null,
      status: 'completed',
      total_turns: storedSession.totalTurns,
      artifacts: {
        transcript_txt: storedSession.artifacts?.transcript_txt || null,
        transcript_json: storedSession.artifacts?.transcript_json || null,
        session_manifest:
          storedSession.artifacts?.session_manifest ||
          storedSession.artifacts?.manifest ||
          storedSession.manifestUrl ||
          null,
        session_audio: storedSession.artifacts?.session_audio || null,
      },
      manifestUrl:
        storedSession.artifacts?.session_manifest ||
        storedSession.artifacts?.manifest ||
        storedSession.manifestUrl ||
        null,
      firstAudioUrl: storedSession.turns.find((turn) => Boolean(turn.audio))?.audio || null,
      sessionAudioUrl: storedSession.artifacts?.session_audio || null,
    })
  }

  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // DEMO: merge client-stored demoHistory (if any) as minimal entries
  let demo: any[] = []
  try {
    const raw = (globalThis as any)?.localStorage?.getItem?.('demoHistory')
    if (raw) demo = JSON.parse(raw)
  } catch {}

  const demoRows = (demo || []).map((entry: any) => ({
    id: entry.id,
    created_at: entry.created_at,
    title: typeof entry.title === 'string' && entry.title.length ? entry.title : null,
    status: 'completed',
    total_turns: 1,
    artifacts: { transcript_txt: null, transcript_json: null },
  }))

  return NextResponse.json({ items: [...demoRows, ...rows] })
}

export async function DELETE(request: Request) {
  const url = new URL(request.url)
  const handle = url.searchParams.get('handle')

  if (handle) {
    const result = await deleteSessionsByHandle(handle)
    return NextResponse.json({ ok: true, deleted: result.deleted, items: [] })
  }

  await clearAllSessions()
  return NextResponse.json({ ok: true, items: [] })
}
