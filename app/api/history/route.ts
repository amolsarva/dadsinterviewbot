import { NextResponse } from 'next/server'
import { listSessions } from '@/lib/data'

export async function GET() {
  const items = await listSessions()
  const rows = items.map(s => ({
    id: s.id, created_at: s.created_at, title: s.title || null,
    status: s.status, total_turns: s.total_turns,
    artifacts: { transcript_txt: Boolean(s.artifacts?.transcript_txt), transcript_json: Boolean(s.artifacts?.transcript_json) }
  }))
  // DEMO: merge client-stored demoHistory (if any) as minimal entries
  let demo: any[] = []
  try {
    const raw = (globalThis as any)?.localStorage?.getItem?.('demoHistory')
    if (raw) demo = JSON.parse(raw)
  } catch {}
  const demoRows = (demo||[]).map(d => ({ id: d.id, created_at: d.created_at, title: 'Demo session', status:'completed', total_turns: 1, artifacts:{ transcript_txt:false, transcript_json:false } }))
  return NextResponse.json({ items: [...demoRows, ...rows] })
}
