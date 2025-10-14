import { NextRequest, NextResponse } from 'next/server'
import {
  blobDiagnostics,
  blobHealth,
  getBlobEnvironment,
  primeNetlifyBlobContextFromHeaders,
} from '@/lib/blob'

export async function GET(request: NextRequest) {
  primeNetlifyBlobContextFromHeaders(request.headers)
  const env = getBlobEnvironment()
  blobDiagnostics('api/debug/blob-status', env)
  const health = await blobHealth()
  return NextResponse.json({ env, health })
}
