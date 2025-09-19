import { NextResponse } from 'next/server'
import { listFoxes } from '@/lib/foxes'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ ok: true, foxes: listFoxes() })
}
