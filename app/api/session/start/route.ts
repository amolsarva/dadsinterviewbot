import { NextRequest, NextResponse } from 'next/server'
import { createSession } from '@/lib/data'
import { primeNetlifyBlobContextFromHeaders } from '@/lib/blob'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  primeNetlifyBlobContextFromHeaders((req as NextRequest | undefined)?.headers)
  let payload: any = {}
  try {
    const raw = await req.text()
    if (raw && raw.trim().length) {
      payload = JSON.parse(raw)
    }
  } catch {
    payload = {}
  }

  const rawEmail = typeof payload?.email === 'string' ? payload.email.trim() : ''
  const emailsEnabled = payload?.emailsEnabled !== false
  const defaultEmail = process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co'
  const targetEmail = emailsEnabled ? rawEmail || defaultEmail : ''
  const userHandle =
    typeof payload?.userHandle === 'string'
      ? payload.userHandle
      : typeof payload?.user_handle === 'string'
      ? payload.user_handle
      : null

  try {
    const session = await createSession({
      email_to: targetEmail,
      user_handle: userHandle,
    })
    return NextResponse.json({ id: session.id, email: session.email_to, emailsEnabled: emailsEnabled })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'session_start_failed' },
      { status: 500 }
    )
  }
}
