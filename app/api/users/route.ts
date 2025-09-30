import { NextResponse } from 'next/server'
import { listUserHandles } from '@/lib/data'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const handles = await listUserHandles()
    return NextResponse.json({ ok: true, handles })
  } catch (err) {
    console.warn('Failed to load user handles', err)
    return NextResponse.json({ ok: false, handles: [] }, { status: 500 })
  }
}
