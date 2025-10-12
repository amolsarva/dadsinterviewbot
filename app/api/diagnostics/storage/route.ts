import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  BLOB_PROXY_PREFIX,
  blobHealth,
  getBlobEnvironment,
  listBlobs,
  putBlobFromBuffer,
  readBlob,
} from '@/lib/blob'

type FlowStep = {
  id: string
  label: string
  ok: boolean
  optional?: boolean
  skipped?: boolean
  method?: string
  url?: string
  status?: number
  durationMs?: number
  message?: string
  note?: string
  error?: string
  responseSnippet?: string
  details?: unknown
}

type FlowDiagnostics = {
  ok: boolean
  probeId: string
  startedAt: string
  origin?: string
  sdkPath?: string
  sdkUrl?: string
  sitePutPath?: string
  directApiPath?: string
  steps: FlowStep[]
}

type InventoryBlob = {
  pathname: string
  url: string
  downloadUrl?: string
  size?: number
  uploadedAt?: string
}

type InventorySection = {
  id: string
  label: string
  prefix: string
  limit: number
  ok: boolean
  scanned: number
  hasMore?: boolean
  cursor?: string
  durationMs?: number
  note?: string
  error?: string
  details?: unknown
  blobs?: InventoryBlob[]
}

type BlobErrorLike = { message?: string; blobDetails?: unknown; cause?: BlobErrorLike }

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function snippet(value: string | null | undefined, limit = 200): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1)}…`
}

function extractBlobDetails(error: BlobErrorLike | undefined): unknown {
  if (!error || typeof error !== 'object') return undefined
  if (error.blobDetails) return error.blobDetails
  if (error.cause && typeof error.cause === 'object') {
    return extractBlobDetails(error.cause)
  }
  return undefined
}

function buildSiteUrl(origin: string | undefined, path: string): string | null {
  if (!origin) return null
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  if (path.startsWith('data:')) {
    return null
  }
  const normalized = path.startsWith('/') ? path : `${BLOB_PROXY_PREFIX}${encodePathSegments(path)}`
  try {
    return new URL(normalized, origin).toString()
  } catch {
    return null
  }
}

async function captureResponseSnippet(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text()
    return snippet(text)
  } catch {
    return undefined
  }
}

export async function GET(req: NextRequest) {
  const env = getBlobEnvironment()
  const health = await blobHealth()
  const flowSteps: FlowStep[] = []

  const probeId = randomUUID()
  const startedAt = new Date().toISOString()
  const origin = req.nextUrl?.origin
  const context: FlowDiagnostics = {
    ok: false,
    probeId,
    startedAt,
    origin,
    steps: flowSteps,
  }

  const isNetlify = env.provider === 'netlify' && env.configured
  const inventorySections: InventorySection[] = []

  if (isNetlify) {
    const basePath = `diagnostics/${probeId}`
    const sdkPath = `${basePath}/sdk-check.json`
    const sitePutPath = `${basePath}/site-proxy-check.json`
    const directApiPath = `${basePath}/direct-api-check.json`
    const payload = JSON.stringify({
      probeId,
      ranAt: startedAt,
      origin,
      source: 'storage-diagnostics',
    })
    const payloadBuffer = Buffer.from(payload, 'utf8')

    context.sdkPath = sdkPath
    context.sitePutPath = sitePutPath
    context.directApiPath = directApiPath

    let sdkUrl: string | undefined

    // Step 1: upload via Netlify SDK
    {
      const started = Date.now()
      try {
        const upload = await putBlobFromBuffer(sdkPath, payloadBuffer, 'application/json', {
          cacheControlMaxAge: 60,
        })
        sdkUrl = upload.url
        context.sdkUrl = upload.url
        flowSteps.push({
          id: 'sdk_write',
          label: 'Upload via Netlify SDK',
          ok: true,
          durationMs: Date.now() - started,
          message: upload.url,
        })
      } catch (error) {
        const err = error as BlobErrorLike
        flowSteps.push({
          id: 'sdk_write',
          label: 'Upload via Netlify SDK',
          ok: false,
          durationMs: Date.now() - started,
          error: err?.message,
          details: extractBlobDetails(err),
        })
      }
    }

    const sdkWriteOk = flowSteps[flowSteps.length - 1]?.ok === true

    // Step 2: read via SDK
    if (sdkWriteOk) {
      const started = Date.now()
      try {
        const record = await readBlob(sdkPath)
        if (record) {
          flowSteps.push({
            id: 'sdk_read',
            label: 'Read via Netlify SDK',
            ok: true,
            durationMs: Date.now() - started,
            message: `${record.size ?? record.buffer.byteLength} bytes`,
          })
        } else {
          flowSteps.push({
            id: 'sdk_read',
            label: 'Read via Netlify SDK',
            ok: false,
            durationMs: Date.now() - started,
            error: 'Blob not found after upload',
          })
        }
      } catch (error) {
        const err = error as BlobErrorLike
        flowSteps.push({
          id: 'sdk_read',
          label: 'Read via Netlify SDK',
          ok: false,
          durationMs: Date.now() - started,
          error: err?.message,
          details: extractBlobDetails(err),
        })
      }
    }

    // Step 3: GET via deployed site proxy
    if (sdkUrl) {
      const siteUrl = buildSiteUrl(origin, sdkUrl)
      if (siteUrl) {
        const started = Date.now()
        try {
          const res = await fetch(siteUrl, {
            method: 'GET',
            headers: { 'user-agent': 'dads-interview-bot/diagnostics' },
            cache: 'no-store',
          })
          const bodySnippet = await captureResponseSnippet(res)
          flowSteps.push({
            id: 'proxy_get',
            label: 'GET via site /api/blob proxy',
            ok: res.ok,
            method: 'GET',
            url: siteUrl,
            status: res.status,
            durationMs: Date.now() - started,
            responseSnippet: bodySnippet,
          })
        } catch (error) {
          const err = error as Error
          flowSteps.push({
            id: 'proxy_get',
            label: 'GET via site /api/blob proxy',
            ok: false,
            method: 'GET',
            url: siteUrl,
            durationMs: Date.now() - started,
            error: err?.message,
          })
        }
      } else {
        flowSteps.push({
          id: 'proxy_get',
          label: 'GET via site /api/blob proxy',
          ok: false,
          optional: true,
          skipped: true,
          message: sdkUrl.startsWith('data:')
            ? 'Proxy URL is a data URI (in-memory fallback); skipping site fetch.'
            : 'Unable to determine site URL for blob proxy.',
        })
      }
    }

    // Step 4: PUT via deployed site proxy (critical for production writes)
    {
      const siteUrl = buildSiteUrl(origin, `${BLOB_PROXY_PREFIX}${encodePathSegments(sitePutPath)}`)
      if (siteUrl) {
        const started = Date.now()
        try {
          const res = await fetch(siteUrl, {
            method: 'PUT',
            body: payloadBuffer,
            headers: {
              'content-type': 'application/json',
              'user-agent': 'dads-interview-bot/diagnostics',
            },
          })
          const bodySnippet = await captureResponseSnippet(res)
          flowSteps.push({
            id: 'proxy_put',
            label: 'PUT via site /api/blob proxy',
            ok: res.ok,
            method: 'PUT',
            url: siteUrl,
            status: res.status,
            durationMs: Date.now() - started,
            responseSnippet: bodySnippet,
          })
        } catch (error) {
          const err = error as Error
          flowSteps.push({
            id: 'proxy_put',
            label: 'PUT via site /api/blob proxy',
            ok: false,
            method: 'PUT',
            url: siteUrl,
            durationMs: Date.now() - started,
            error: err?.message,
          })
        }
      } else {
        flowSteps.push({
          id: 'proxy_put',
          label: 'PUT via site /api/blob proxy',
          ok: false,
          optional: true,
          skipped: true,
          error: 'Unable to construct site proxy URL for PUT test.',
        })
      }
    }

    // Step 5: GET the site PUT target to verify persistence
    {
      const siteUrl = buildSiteUrl(origin, `${BLOB_PROXY_PREFIX}${encodePathSegments(sitePutPath)}`)
      if (siteUrl) {
        const started = Date.now()
        try {
          const res = await fetch(siteUrl, {
            method: 'GET',
            headers: { 'user-agent': 'dads-interview-bot/diagnostics' },
            cache: 'no-store',
          })
          const bodySnippet = await captureResponseSnippet(res)
          flowSteps.push({
            id: 'proxy_put_verify',
            label: 'GET site PUT target',
            ok: res.ok,
            method: 'GET',
            url: siteUrl,
            status: res.status,
            durationMs: Date.now() - started,
            responseSnippet: bodySnippet,
          })
        } catch (error) {
          const err = error as Error
          flowSteps.push({
            id: 'proxy_put_verify',
            label: 'GET site PUT target',
            ok: false,
            method: 'GET',
            url: siteUrl,
            durationMs: Date.now() - started,
            error: err?.message,
          })
        }
      } else {
        flowSteps.push({
          id: 'proxy_put_verify',
          label: 'GET site PUT target',
          ok: false,
          optional: true,
          skipped: true,
          error: 'Unable to construct verification URL for PUT test.',
        })
      }
    }

    // Step 6: Direct Netlify API PUT/GET/DELETE checks (optional but informative)
    const token =
      (process.env.NETLIFY_BLOBS_TOKEN || '').trim() ||
      (process.env.BLOBS_TOKEN || '').trim() ||
      (process.env.NETLIFY_API_TOKEN || '').trim()
    const siteId = env.siteId
    const storeName = env.store
    const apiBase = (process.env.NETLIFY_BLOBS_API_URL || 'https://api.netlify.com/api/v1/blobs')
      .replace(/\/+$/, '')

    if (token && siteId && storeName) {
      const directUrl = `${apiBase}/sites/${encodeURIComponent(siteId)}/stores/${encodeURIComponent(
        storeName,
      )}/items/${encodePathSegments(directApiPath)}`

      // PUT
      {
        const started = Date.now()
        try {
          const res = await fetch(directUrl, {
            method: 'PUT',
            body: payloadBuffer,
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
              'user-agent': 'dads-interview-bot/diagnostics',
            },
          })
          const bodySnippet = await captureResponseSnippet(res)
          flowSteps.push({
            id: 'direct_api_put',
            label: 'PUT via Netlify blobs API',
            ok: res.ok,
            optional: true,
            method: 'PUT',
            url: directUrl,
            status: res.status,
            durationMs: Date.now() - started,
            responseSnippet: bodySnippet,
          })
        } catch (error) {
          const err = error as Error
          flowSteps.push({
            id: 'direct_api_put',
            label: 'PUT via Netlify blobs API',
            ok: false,
            optional: true,
            method: 'PUT',
            url: directUrl,
            durationMs: Date.now() - started,
            error: err?.message,
          })
        }
      }

      // GET
      {
        const started = Date.now()
        try {
          const res = await fetch(directUrl, {
            method: 'GET',
            headers: {
              authorization: `Bearer ${token}`,
              'user-agent': 'dads-interview-bot/diagnostics',
            },
          })
          const bodySnippet = await captureResponseSnippet(res)
          flowSteps.push({
            id: 'direct_api_get',
            label: 'GET via Netlify blobs API',
            ok: res.ok,
            optional: true,
            method: 'GET',
            url: directUrl,
            status: res.status,
            durationMs: Date.now() - started,
            responseSnippet: bodySnippet,
          })
        } catch (error) {
          const err = error as Error
          flowSteps.push({
            id: 'direct_api_get',
            label: 'GET via Netlify blobs API',
            ok: false,
            optional: true,
            method: 'GET',
            url: directUrl,
            durationMs: Date.now() - started,
            error: err?.message,
          })
        }
      }

      // DELETE
      {
        const started = Date.now()
        try {
          const res = await fetch(directUrl, {
            method: 'DELETE',
            headers: {
              authorization: `Bearer ${token}`,
              'user-agent': 'dads-interview-bot/diagnostics',
            },
          })
          const bodySnippet = await captureResponseSnippet(res)
          flowSteps.push({
            id: 'direct_api_delete',
            label: 'DELETE via Netlify blobs API',
            ok: res.ok || res.status === 404,
            optional: true,
            method: 'DELETE',
            url: directUrl,
            status: res.status,
            durationMs: Date.now() - started,
            responseSnippet: bodySnippet,
            note: res.status === 404 ? 'Resource already removed' : undefined,
          })
        } catch (error) {
          const err = error as Error
          flowSteps.push({
            id: 'direct_api_delete',
            label: 'DELETE via Netlify blobs API',
            ok: false,
            optional: true,
            method: 'DELETE',
            url: directUrl,
            durationMs: Date.now() - started,
            error: err?.message,
          })
        }
      }
    } else {
      flowSteps.push({
        id: 'direct_api_put',
        label: 'PUT via Netlify blobs API',
        ok: false,
        optional: true,
        skipped: true,
        error: 'Missing NETLIFY_BLOBS_TOKEN or site/store identifiers; skipping direct API checks.',
      })
    }
    const inventoryConfig: Array<{ id: string; label: string; prefix: string; limit: number; note?: string }> = [
      { id: 'root', label: 'All blobs (alphabetical sample)', prefix: '', limit: 25, note: 'First 25 entries from the store.' },
      { id: 'sessions', label: 'Session manifests', prefix: 'sessions/', limit: 25 },
      { id: 'transcripts', label: 'Transcripts', prefix: 'transcripts/', limit: 25 },
      { id: 'primers', label: 'Memory primers', prefix: 'memory-primers/', limit: 25 },
      { id: 'diagnostics', label: 'Diagnostics probes', prefix: 'diagnostics/', limit: 25 },
    ]

    for (const section of inventoryConfig) {
      const started = Date.now()
      try {
        const result = await listBlobs({ prefix: section.prefix, limit: section.limit })
        const blobs: InventoryBlob[] = result.blobs.map((blob) => ({
          pathname: blob.pathname,
          url: blob.url,
          downloadUrl: blob.downloadUrl,
          size: typeof blob.size === 'number' && Number.isFinite(blob.size) ? blob.size : undefined,
          uploadedAt: blob.uploadedAt ? blob.uploadedAt.toISOString() : undefined,
        }))
        inventorySections.push({
          id: section.id,
          label: section.label,
          prefix: section.prefix,
          limit: section.limit,
          ok: true,
          scanned: blobs.length,
          hasMore: result.hasMore,
          cursor: result.cursor,
          durationMs: Date.now() - started,
          note: section.note,
          blobs,
        })
      } catch (error) {
        const err = error as BlobErrorLike
        inventorySections.push({
          id: section.id,
          label: section.label,
          prefix: section.prefix,
          limit: section.limit,
          ok: false,
          scanned: 0,
          durationMs: Date.now() - started,
          note: section.note,
          error: err?.message,
          details: extractBlobDetails(err),
        })
      }
    }
  } else {
    flowSteps.push({
      id: 'netlify_config',
      label: 'Netlify blob configuration',
      ok: false,
      optional: true,
      skipped: true,
      error: 'Netlify blob storage is not configured; skipping flow diagnostics.',
    })
  }

  const requiredFailures = flowSteps.filter((step) => !step.optional && !step.ok && !step.skipped)
  const flowOk = requiredFailures.length === 0
  context.ok = flowOk

  const ok = isNetlify && health.ok && health.mode === 'netlify' && flowOk

  let message: string

  if (ok) {
    message = `Netlify blob store "${(env as any).store || 'default'}" responded to SDK and proxy checks.`
  } else if (!isNetlify) {
    const missing = env.diagnostics?.missing?.length ? env.diagnostics.missing.join(', ') : null
    message = missing
      ? `Storage is running in in-memory fallback mode. Missing configuration: ${missing}.`
      : 'Storage is running in in-memory fallback mode.'
  } else if (!health.ok || health.mode !== 'netlify') {
    message = `Netlify storage health check failed: ${health.reason || 'unknown error'}`
  } else if (!flowOk && requiredFailures.length) {
    const first = requiredFailures[0]
    const statusLabel = typeof first.status === 'number' ? ` (HTTP ${first.status})` : ''
    const methodLabel = first.method ? `${first.method} ` : ''
    const errorLabel = first.error ? ` — ${first.error}` : first.responseSnippet ? ` — ${first.responseSnippet}` : ''
    message = `Blob flow failed during ${methodLabel}${first.label}${statusLabel}${errorLabel}`
  } else {
    message = 'Netlify storage diagnostics completed with warnings. Review flow steps for details.'
  }

  const totalScanned = inventorySections.reduce((count, section) => count + section.scanned, 0)

  return NextResponse.json({
    ok,
    env,
    health,
    message,
    flow: context,
    inventory: inventorySections.length
      ? {
          sections: inventorySections,
          totalScanned,
        }
      : null,
  })
}
