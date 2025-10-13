import { NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment, primeNetlifyBlobContextFromHeaders } from '@/lib/blob'
import { dbHealth } from '@/lib/data'
import { areSummaryEmailsEnabled } from '@/lib/email'

export async function GET(request: Request) {
  primeNetlifyBlobContextFromHeaders(request.headers)
  const blob = await blobHealth()
  const db = await dbHealth()
  const storageEnv = getBlobEnvironment()
  const env = {
    hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
    hasBlobStore: storageEnv.configured,
    storageProvider: storageEnv.provider,
    storageStore: (storageEnv as any).store ?? null,
    storageSiteId: (storageEnv as any).siteId ?? null,
    storageError: storageEnv.error ?? null,
    hasResend: Boolean(process.env.RESEND_API_KEY),
    emailsEnabled: areSummaryEmailsEnabled(),
    defaultEmail: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co',
    blobDiagnostics: storageEnv.diagnostics,
  }
  return NextResponse.json({ ok: true, env, blob, db })
}
