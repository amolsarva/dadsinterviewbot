import { NextRequest, NextResponse } from 'next/server'
import { deleteSession } from '@/lib/data'
import { normalizeUserId } from '@/lib/users'

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const id = params?.id
  if (!id) {
    return NextResponse.json({ ok: false, deleted: false, reason: 'missing_id' }, { status: 400 })
  }

  const userId = normalizeUserId(request.nextUrl.searchParams.get('user'))
  const result = await deleteSession(userId, id)
  const status = result.ok ? 200 : 500
  return NextResponse.json(result, { status })
}
