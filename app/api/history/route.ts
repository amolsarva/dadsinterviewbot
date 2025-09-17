import { NextResponse } from 'next/server'
import { listSessions } from '@/lib/data'
import { fetchStoredSessions } from '@/lib/history'

export async function GET() {
  const items = await listSessions()
  const rows = items.map(s => ({
    id: s.id,
    created_at: s.created_at,
    title: s.title || null,
    status: s.status,
    total_turns: s.total_turns,
    artifacts: {
      transcript_txt: s.artifacts?.transcript_txt || null,
      transcript_json: s.artifacts?.transcript_json || null,
    },
    manifestUrl: s.artifacts?.manifest || null,
    firstAudioUrl: s.turns?.find(t => t.audio_blob_url)?.audio_blob_url || null,
  }))

  const { items: stored } = await fetchStoredSessions({ limit: 50 })
  for (const session of stored) {
    if (rows.some(r => r.id === session.sessionId)) continue
    rows.push({
      id: session.sessionId,
      created_at: session.startedAt || session.endedAt || new Date().toISOString(),
      title: null,
      status: 'completed',
      total_turns: session.totalTurns,
      artifacts: {
        transcript_txt: session.artifacts?.transcript_txt || null,
        transcript_json: session.artifacts?.transcript_json || null,
      },
      manifestUrl: session.artifacts?.manifest || session.manifestUrl,
      firstAudioUrl: session.turns.find(t => Boolean(t.audio))?.audio || null,
    })
  }

  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  // DEMO: merge client-stored demoHistory (if any) as minimal entries
  let demo: any[] = []
  try {
    const raw = (globalThis as any)?.localStorage?.getItem?.('demoHistory')
    if (raw) demo = JSON.parse(raw)
  } catch {}
  const demoRows = (demo||[]).map(d => ({ id: d.id, created_at: d.created_at, title: 'Demo session', status:'completed', total_turns: 1, artifacts:{ transcript_txt: null, transcript_json: null } }))
  return NextResponse.json({ items: [...demoRows, ...rows] })
}
