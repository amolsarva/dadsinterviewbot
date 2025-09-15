import { NextResponse } from 'next/server'
import { blobHealth } from '@/lib/blob'
import { dbHealth } from '@/lib/data'

export async function GET() {
  const blob = await blobHealth()
  const db = await dbHealth()
  return NextResponse.json({ ok: true, blob, db })
}
