import { NextResponse } from 'next/server'
import { createSession } from '@/lib/data'

export const runtime = 'nodejs'

export async function POST() {
  try {
    const session = await createSession({
      email_to: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co',
    })
    return NextResponse.json({ id: session.id })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'session_start_failed' },
      { status: 500 }
    )
  }
}
