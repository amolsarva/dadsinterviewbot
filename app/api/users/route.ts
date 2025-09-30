import { NextResponse } from 'next/server'
import { listUserHandles } from '@/lib/data'

export const runtime = 'nodejs'

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(parsed, 24)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const handles = await listUserHandles({ limit })
  return NextResponse.json({ ok: true, handles })
}
