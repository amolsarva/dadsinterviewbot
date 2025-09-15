import { NextRequest, NextResponse } from 'next/server'
import { finalizeSession } from '@/lib/data'

export async function POST(req: NextRequest, { params }: { params: { id: string }}) {
  const body = await req.json()
  const result = await finalizeSession(params.id, body)
  return NextResponse.json(result)
}
