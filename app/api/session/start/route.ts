import { NextResponse } from 'next/server'
import { createSession } from '@/lib/data'

export async function POST() {
  const s = await createSession({ email_to: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co' })
  return NextResponse.json(s)
}
