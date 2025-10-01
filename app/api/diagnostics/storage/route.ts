import { NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment } from '@/lib/blob'

export async function GET() {
  const env = getBlobEnvironment()
  const health = await blobHealth()
  const ok = env.provider === 'netlify' && env.configured && health.ok && health.mode === 'netlify'
  const message = ok
    ? `Netlify blob store \"${(env as any).store || 'default'}\" is responding.`
    : env.provider !== 'netlify'
    ? 'Storage is running in in-memory fallback mode.'
    : health.ok
    ? 'Netlify storage configured but not returning expected mode.'
    : `Netlify storage health check failed: ${health.reason || 'unknown error'}`

  return NextResponse.json({ ok, env, health, message })
}
