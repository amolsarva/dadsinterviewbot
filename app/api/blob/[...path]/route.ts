import { NextRequest, NextResponse } from 'next/server'
import { getFallbackBlob } from '@/lib/blob'

function notFound() {
  return new NextResponse('Not found', { status: 404 })
}

function buildFilename(segments: string[]): string {
  const raw = segments[segments.length - 1] || 'download'
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized || 'download'
}

function createResponse(
  paramsPath: string[] | undefined,
  includeBody: boolean,
  download: boolean
) {
  const segments = Array.isArray(paramsPath) ? paramsPath : []
  if (!segments.length) return notFound()
  const key = segments.join('/')
  const record = getFallbackBlob(key)
  if (!record) return notFound()

  const headers = new Headers()
  headers.set('Content-Type', record.contentType)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Length', String(record.buffer.byteLength))

  const filename = buildFilename(segments)
  const disposition = download ? 'attachment' : 'inline'
  headers.set('Content-Disposition', `${disposition}; filename="${filename}"`)

  const body = includeBody ? record.buffer : null
  return new NextResponse(body, { status: 200, headers })
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  const download = req.nextUrl.searchParams.has('download')
  return createResponse(ctx.params.path, true, download)
}

export async function HEAD(req: NextRequest, ctx: { params: { path: string[] } }) {
  const download = req.nextUrl.searchParams.has('download')
  return createResponse(ctx.params.path, false, download)
}
