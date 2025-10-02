import { NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment } from '@/lib/blob'

export async function GET() {
  const env = getBlobEnvironment()
  const health = await blobHealth()
  const ok = env.provider === 'netlify' && env.configured && health.ok && health.mode === 'netlify'
  let message: string

  if (ok) {
    message = `Netlify blob store "${(env as any).store || 'default'}" is responding.`
  } else if (env.provider !== 'netlify') {
    const missing = env.diagnostics?.missing?.length ? env.diagnostics.missing.join(', ') : null
    message = missing
      ? `Storage is running in in-memory fallback mode. Missing configuration: ${missing}.`
      : 'Storage is running in in-memory fallback mode.'
  } else if (health.ok) {
    message = 'Netlify storage configured but not returning expected mode.'
  } else {
    message = `Netlify storage health check failed: ${health.reason || 'unknown error'}`
  }

  return NextResponse.json({ ok, env, health, message })
}
