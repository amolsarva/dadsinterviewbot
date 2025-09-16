import { NextResponse } from 'next/server'
import { sendSummaryEmail } from '@/lib/email'

export async function POST() {
  try {
    const to = process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co'
    const subject = 'Interview Bot – Test Email'
    const body = 'This is a test email from /api/diagnostics/email.'
    const status = await sendSummaryEmail(to, subject, body)
    return NextResponse.json({ ok: true, status })
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e?.message || 'email_failed' }, { status: 500 })
  }
}


