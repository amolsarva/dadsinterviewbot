import { NextResponse } from 'next/server'
import { sendSummaryEmail } from '@/lib/email'

export const runtime = 'nodejs'

type Stage = 'send_email'

function wrapStage<T>(stage: Stage, task: () => Promise<T>): Promise<T> {
  return task().catch(err => {
    const error = err instanceof Error ? err : new Error(String(err))
    ;(error as any).diagnosticStage = stage
    throw error
  })
}

export async function POST() {
  try {
    const to = process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co'
    const subject = 'Interview Bot – Test Email'
    const body = 'This is a test email from /api/diagnostics/email.'
    const status = await wrapStage('send_email', () => sendSummaryEmail(to, subject, body))
    return NextResponse.json({ ok: true, status })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'email_failed',
        stage: error?.diagnosticStage || 'unknown',
      },
      { status: 500 }
    )
  }
}

