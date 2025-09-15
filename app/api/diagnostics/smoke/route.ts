import { NextResponse } from 'next/server'
import { createSession, appendTurn, finalizeSession } from '@/lib/data'

export async function POST() {
  const s = await createSession({ email_to: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co' })
  await appendTurn(s.id, { role: 'user', text: 'Hello world' } as any)
  await appendTurn(s.id, { role: 'assistant', text: 'Tell me more about that.' } as any)
  const out = await finalizeSession(s.id, { clientDurationMs: 5000 })
  return NextResponse.json({ ok: true, sessionId: s.id, artifacts: out.session.artifacts, emailed: out.emailed })
}
