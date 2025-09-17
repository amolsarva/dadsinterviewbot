import { NextRequest, NextResponse } from 'next/server'
import { fetchStoredSessions } from '@/lib/history'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const page = Number(url.searchParams.get('page') || '1')
    const limit = Number(url.searchParams.get('limit') || '10')

    const { items } = await fetchStoredSessions({ page, limit })
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ items: [] })
  }
}
