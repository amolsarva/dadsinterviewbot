import { NextRequest, NextResponse } from 'next/server'
import { listBlobs, deleteBlobsByPrefix, primeNetlifyBlobContextFromHeaders } from '@/lib/blob'

function normalizePrefix(prefix: string | null): string {
  if (!prefix) return ''
  return prefix.replace(/^\/+/, '')
}

export async function GET(request: NextRequest) {
  primeNetlifyBlobContextFromHeaders(request.headers)
  const url = new URL(request.url)
  const prefix = normalizePrefix(url.searchParams.get('prefix'))
  const limitParam = url.searchParams.get('limit')
  const cursor = url.searchParams.get('cursor') || undefined
  const limit = limitParam ? Math.min(200, Math.max(1, Number.parseInt(limitParam, 10) || 50)) : 50

  const result = await listBlobs({ prefix, cursor, limit })
  return NextResponse.json(result)
}

export async function DELETE(request: NextRequest) {
  primeNetlifyBlobContextFromHeaders(request.headers)
  const url = new URL(request.url)
  const prefix = normalizePrefix(url.searchParams.get('prefix'))
  if (!prefix) {
    return NextResponse.json({ ok: false, reason: 'prefix required' }, { status: 400 })
  }
  const deleted = await deleteBlobsByPrefix(prefix)
  return NextResponse.json({ ok: true, deleted })
}
