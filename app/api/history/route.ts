import { NextResponse } from 'next/server'
import { listSessions } from '@/lib/data'

export async function GET() {
  const items = await listSessions()
  return NextResponse.json({ items })
}
