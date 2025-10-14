import { NextRequest, NextResponse } from 'next/server'
import {
  BLOB_PROXY_PREFIX,
  deleteBlob,
  primeNetlifyBlobContextFromHeaders,
  putBlobFromBuffer,
  readBlob,
} from '@/lib/blob'
import { jsonErrorResponse } from '@/lib/api-error'

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

  let record
  try {
    record = await readBlob(path)
  } catch (error) {
    const fallbackMessage =
      error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.trim().length
        ? (error as any).message
        : 'failed to read blob'
    return jsonErrorResponse(error, fallbackMessage, undefined, { reason: fallbackMessage })
  }
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

function primeContext(req: Request | NextRequest) {
  try {
    primeNetlifyBlobContextFromHeaders(req.headers)
  } catch {
    // ignore header parsing failures
  }
}

export async function GET(req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(req)
  const path = extractPath(params)
  const download = req.nextUrl.searchParams.has('download')
  return handleBlobRequest(path, download, true)
}

export async function HEAD(req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(req)
  const path = extractPath(params)
  const download = req.nextUrl.searchParams.has('download')
  return handleBlobRequest(path, download, false)
}

export async function PUT(req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(req)
  const path = extractPath(params)
  if (!path) {
    return NextResponse.json({ ok: false, reason: 'missing path' }, { status: 400 })
  }

  const arrayBuffer = await req.arrayBuffer()
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    return NextResponse.json({ ok: false, reason: 'missing body' }, { status: 400 })
  }

  const contentType = req.headers.get('content-type') || 'application/octet-stream'
  const cacheControlHeader = req.headers.get('cache-control') || undefined
  const explicitMaxAge = req.headers.get('x-cache-control-max-age')

  let cacheControlMaxAge: number | undefined
  if (explicitMaxAge) {
    const parsed = Number.parseInt(explicitMaxAge, 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      cacheControlMaxAge = parsed
    }
  } else if (cacheControlHeader) {
    const match = /max-age\s*=\s*(\d+)/i.exec(cacheControlHeader)
    if (match) {
      const parsed = Number.parseInt(match[1], 10)
      if (Number.isFinite(parsed) && parsed >= 0) {
        cacheControlMaxAge = parsed
      }
    }
  }

  const buffer = Buffer.from(arrayBuffer)

  try {
    const result = await putBlobFromBuffer(path, buffer, contentType, {
      cacheControlMaxAge,
    })
    const response = NextResponse.json({ ok: true, url: result.url, downloadUrl: result.downloadUrl }, { status: 201 })
    if (result.url) {
      response.headers.set('Location', result.url)
    }
    if (cacheControlHeader) {
      response.headers.set('Cache-Control', cacheControlHeader)
    }
    return response
  } catch (error) {
    const status =
      error && typeof error === 'object' && typeof (error as any).status === 'number' && (error as any).status >= 400
        ? (error as any).status
        : 500
    const fallbackMessage =
      error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.length
        ? (error as any).message
        : 'failed to upload blob'
    return jsonErrorResponse(error, fallbackMessage, status, { reason: fallbackMessage })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(_req)
  const path = extractPath(params)
  if (!path) {
    return NextResponse.json({ ok: false, reason: 'missing path' }, { status: 400 })
  }

  try {
    const deleted = await deleteBlob(path)
    if (!deleted) {
      return NextResponse.json({ ok: false, reason: 'not found' }, { status: 404 })
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const status =
      error && typeof error === 'object' && typeof (error as any).status === 'number' && (error as any).status >= 400
        ? (error as any).status
        : 500
    const fallbackMessage =
      error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.length
        ? (error as any).message
        : 'failed to delete blob'
    return jsonErrorResponse(error, fallbackMessage, status, { reason: fallbackMessage })
  }
}
