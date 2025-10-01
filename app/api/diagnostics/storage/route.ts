import { NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment } from '@/lib/blob'

export async function GET() {
  const env = getBlobEnvironment()
  const health = await blobHealth()
  const ok = env.provider === 'supabase' && env.configured && health.ok && health.mode === 'supabase'
  const message = ok
    ? 'Supabase storage configured and responding.'
    : env.provider !== 'supabase'
    ? 'Storage is running in in-memory fallback mode.'
    : health.ok
    ? 'Supabase storage configured but not returning expected mode.'
    : `Supabase health check failed: ${health.reason || 'unknown error'}`

  return NextResponse.json({ ok, env, health, message })
}
