import { NextRequest, NextResponse } from 'next/server'
import { appendTurn } from '@/lib/data'
import { normalizeUserId } from '@/lib/users'
import { z } from 'zod'

export async function POST(req: NextRequest, { params }: { params: { id: string }}) {
  try {
    const body = await req.json()
    const schema = z.object({
      role: z.enum(['user','assistant']),
      text: z.string().default(''),
      audio_blob_url: z.string().url().optional(),
    })
    const parsed = schema.parse(body)
    const userId = normalizeUserId(req.nextUrl.searchParams.get('user'))
    const turn = await appendTurn(userId, params.id, parsed as any)
    return NextResponse.json(turn)
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? 'bad_request' }, { status: 400 })
  }
}
