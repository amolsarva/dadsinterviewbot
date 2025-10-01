import { NextRequest, NextResponse } from 'next/server'
import { BLOB_PROXY_PREFIX, readBlob } from '@/lib/blob'

function extractPath(params: { path?: string[] | string }): string {
  const raw = params?.path
  if (!raw) return ''
  if (Array.isArray(raw)) return raw.join('/')
  return raw
}

function buildFilename(path: string): string {
  const segments = normalizePath(path).split('/')
  const raw = segments[segments.length - 1] || 'download'
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized || 'download'
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '')
}

async function handleBlobRequest(path: string, download: boolean, includeBody: boolean) {
  if (!path) {
    return NextResponse.json({ ok: false, reason: 'missing path' }, { status: 400 })
  }

  const record = await readBlob(path)
  if (!record) {
    return NextResponse.json({ ok: false, reason: 'not found' }, { status: 404 })
  }

  const filename = buildFilename(path)
  const disposition = download ? 'attachment' : 'inline'
  const body = includeBody ? record.buffer : null
  const response = new NextResponse(body)
  response.headers.set('Content-Type', record.contentType)
  if (record.cacheControl) {
    response.headers.set('Cache-Control', record.cacheControl)
  } else {
    response.headers.set('Cache-Control', 'public, max-age=60')
  }
  response.headers.set('Content-Disposition', `${disposition}; filename="${filename}"`)
  if (record.etag) {
    response.headers.set('ETag', record.etag)
  }
  if (record.uploadedAt) {
    const lastModified = new Date(record.uploadedAt)
    if (!Number.isNaN(lastModified.valueOf())) {
      response.headers.set('Last-Modified', lastModified.toUTCString())
    }
  }
  if (typeof record.size === 'number' && Number.isFinite(record.size)) {
    response.headers.set('Content-Length', String(Math.max(0, Math.trunc(record.size))))
  }
  const normalizedPath = normalizePath(path)
  response.headers.set('X-Blob-Path', `${BLOB_PROXY_PREFIX}${encodeURIComponent(normalizedPath)}`)
  return response
}

export async function GET(_req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  const path = extractPath(params)
  const download = _req.nextUrl.searchParams.has('download')
  return handleBlobRequest(path, download, true)
}

export async function HEAD(_req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  const path = extractPath(params)
  const download = _req.nextUrl.searchParams.has('download')
  return handleBlobRequest(path, download, false)
}
