import { NextResponse } from 'next/server'
import { blobHealth } from '@/lib/blob'
import { dbHealth } from '@/lib/data'

export async function GET() {
  const blob = await blobHealth()
  const db = await dbHealth()
  const env = {
    hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
    hasBlobToken: Boolean(process.env.VERCEL_BLOB_READ_WRITE_TOKEN),
    hasResend: Boolean(process.env.RESEND_API_KEY),
    defaultEmail: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co',
  }
  return NextResponse.json({ ok: true, env, blob, db })
}
