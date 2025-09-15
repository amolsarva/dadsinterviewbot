import { NextResponse } from 'next/server'
import { listSessions } from '@/lib/data'

export async function GET() {
  const items = await listSessions()
  const rows = items.map(s => ({
    id: s.id, created_at: s.created_at, title: s.title || null,
    status: s.status, total_turns: s.total_turns,
    artifacts: { transcript_txt: Boolean(s.artifacts?.transcript_txt), transcript_json: Boolean(s.artifacts?.transcript_json) }
  }))
  return NextResponse.json({ items: rows })
}
