import { NextRequest, NextResponse } from 'next/server'
import { appendTurn } from '@/lib/data'

export async function POST(req: NextRequest, { params }: { params: { id: string }}) {
  const body = await req.json()
  const turn = await appendTurn(params.id, body)
  return NextResponse.json(turn)
}
