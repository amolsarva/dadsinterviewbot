import { NextRequest, NextResponse } from 'next/server'
import {
  BLOB_PROXY_PREFIX,
  deleteBlob,
  primeNetlifyBlobContextFromHeaders,
  putBlobFromBuffer,
  readBlob,
} from '@/lib/blob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

function withStandardHeaders(response: NextResponse) {
  response.headers.set('Vary', 'Authorization, x-nf-site-id')
  return response
}

function resolveBlobErrorDetails(error: any): unknown {
  if (!error || typeof error !== 'object') return undefined
  if ((error as any).blobDetails) return (error as any).blobDetails
  if ((error as any).cause && typeof (error as any).cause === 'object') {
    return resolveBlobErrorDetails((error as any).cause)
  }
  return undefined
}

function buildBlobErrorResponse(
  error: any,
  fallbackStatus: number,
  extras: Record<string, unknown> = {},
) {
  const details = resolveBlobErrorDetails(error)
  const statusFromError =
    typeof error?.status === 'number' && Number.isFinite(error.status) ? error.status : undefined
  const statusFromDetails =
    typeof (details as any)?.status === 'number' && Number.isFinite((details as any).status)
      ? ((details as any).status as number)
      : undefined
  const status = statusFromError || statusFromDetails || fallbackStatus
  const reasonCandidate =
    typeof error?.message === 'string' && error.message.trim().length
      ? error.message.trim()
      : typeof (details as any)?.originalMessage === 'string' && (details as any).originalMessage.trim().length
      ? (details as any).originalMessage.trim()
      : 'blob_error'
  const requestIdCandidate =
    typeof error?.requestId === 'string' && error.requestId.trim().length
      ? error.requestId.trim()
      : typeof (details as any)?.requestId === 'string' && (details as any).requestId.trim().length
      ? ((details as any).requestId as string).trim()
      : undefined

  const payload: Record<string, unknown> = { ok: false, reason: reasonCandidate, ...extras }
  if (requestIdCandidate) {
    payload.requestId = requestIdCandidate
  }
  if (details) {
    payload.details = details
  }
  const response = NextResponse.json(payload, { status })
  if (requestIdCandidate) {
    response.headers.set('x-blob-request-id', requestIdCandidate)
  }
  return withStandardHeaders(response)
}

async function handleBlobRequest(path: string, download: boolean, includeBody: boolean) {
  if (!path) {
    return withStandardHeaders(
      NextResponse.json({ ok: false, reason: 'missing path', path }, { status: 400 }),
    )
  }

  try {
    const record = await readBlob(path)
    if (!record) {
      return withStandardHeaders(
        NextResponse.json({ ok: false, reason: 'not found', path }, { status: 404 }),
      )
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
    return withStandardHeaders(response)
  } catch (error: any) {
    return buildBlobErrorResponse(error, 500, { path })
  }
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
    return withStandardHeaders(
      NextResponse.json({ ok: false, reason: 'missing path', path }, { status: 400 }),
    )
  }

  const arrayBuffer = await req.arrayBuffer()
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
    return withStandardHeaders(
      NextResponse.json({ ok: false, reason: 'missing body', path }, { status: 400 }),
    )
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
    const response = NextResponse.json(
      {
        ok: true,
        url: result.url,
        downloadUrl: result.downloadUrl,
        via: result.via,
        store: result.store ?? null,
        siteId: result.siteId ?? null,
        path,
      },
      { status: 201 },
    )
    if (result.url) {
      response.headers.set('Location', result.url)
    }
    if (cacheControlHeader) {
      response.headers.set('Cache-Control', cacheControlHeader)
    }
    if (result.store) {
      response.headers.set('X-Blob-Store', result.store)
    }
    response.headers.set('X-Blob-Mode', result.via)
    if (result.siteId) {
      response.headers.set('X-Blob-Site', result.siteId)
    }
    return withStandardHeaders(response)
  } catch (error: any) {
    return buildBlobErrorResponse(error, 500, { path })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { path?: string[] | string } }) {
  primeContext(_req)
  const path = extractPath(params)
  if (!path) {
    return withStandardHeaders(
      NextResponse.json({ ok: false, reason: 'missing path', path }, { status: 400 }),
    )
  }

  try {
    const deleted = await deleteBlob(path)
    if (!deleted) {
      return withStandardHeaders(
        NextResponse.json({ ok: false, reason: 'not found', path }, { status: 404 }),
      )
    }
    return withStandardHeaders(new NextResponse(null, { status: 204 }))
  } catch (error: any) {
    return buildBlobErrorResponse(error, 500, { path })
  }
}
