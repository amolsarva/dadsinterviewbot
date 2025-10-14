import { NextRequest, NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment, primeNetlifyBlobContextFromHeaders } from '@/lib/blob'

export async function GET(request: NextRequest) {
  primeNetlifyBlobContextFromHeaders(request.headers)
  const env = getBlobEnvironment()
  const health = await blobHealth()
  return NextResponse.json({ env, health })
}
