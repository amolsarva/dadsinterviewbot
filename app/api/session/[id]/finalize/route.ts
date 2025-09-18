import { NextRequest, NextResponse } from 'next/server'
import { finalizeSession } from '@/lib/data'
import { z } from 'zod'

export async function POST(req: NextRequest, { params }: { params: { id: string }}) {
  try {
    const body = await req.json()
    const schema = z.object({
      clientDurationMs: z.number().nonnegative().default(0),
      sessionAudioUrl: z.string().min(1).optional(),
    })
    const { clientDurationMs, sessionAudioUrl } = schema.parse(body)
    const result = await finalizeSession(params.id, { clientDurationMs, sessionAudioUrl })
    return NextResponse.json(result)
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? 'bad_request' }, { status: 400 })
  }
}
