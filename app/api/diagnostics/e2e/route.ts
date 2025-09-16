import { NextResponse } from 'next/server'
import { appendTurn, createSession, finalizeSession } from '@/lib/data'

export async function POST() {
  try {
    const s = await createSession({ email_to: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co' })
    // Simulate a quick user/assistant exchange
    await appendTurn(s.id, { role: 'user', text: 'Hello world' } as any)
    await appendTurn(s.id, { role: 'assistant', text: 'Tell me more about that.' } as any)
    const out = await finalizeSession(s.id, { clientDurationMs: 1500 })
    return NextResponse.json({ ok: true, sessionId: s.id, result: out })
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e?.message || 'e2e_failed' }, { status: 500 })
  }
}


