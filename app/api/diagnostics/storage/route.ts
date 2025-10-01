import { NextResponse } from 'next/server'
import { blobHealth, getBlobEnvironment, listBlobs } from '@/lib/blob'

type CheckStatus = 'ok' | 'warning' | 'error'

type CheckResult = {
  id: string
  label: string
  status: CheckStatus
  detail: string
  meta?: Record<string, string | number | boolean | null>
}

type SupabaseDiagnostics = {
  configured: boolean
  urlHost: string | null
  bucket: string | null
  keyType: 'service_role' | 'anon' | null
  checks: CheckResult[]
}

const MAX_BODY_PREVIEW = 240

const formatPreview = (input: string | null | undefined): string => {
  if (!input) return ''
  const trimmed = input.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= MAX_BODY_PREVIEW) return trimmed
  return `${trimmed.slice(0, MAX_BODY_PREVIEW)}…`
}

const maskKey = (key: string): string => {
  const normalized = key.trim()
  if (normalized.length <= 8) return normalized.replace(/./g, '•')
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`
}

const inferProjectRef = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname || ''
    const [projectRef] = host.split('.')
    return projectRef || null
  } catch {
    return null
  }
}

const normalizeUrl = (url: string): string => url.replace(/\/+$/, '')

const toStatus = (ok: boolean, warning: boolean = false): CheckStatus => {
  if (ok) return 'ok'
  return warning ? 'warning' : 'error'
}

async function gatherSupabaseDiagnostics(): Promise<SupabaseDiagnostics> {
  const rawUrl =
    (process.env.SUPABASE_URL || '').trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
  const url = rawUrl ? normalizeUrl(rawUrl) : ''
  const bucket =
    (process.env.SUPABASE_STORAGE_BUCKET || '').trim() ||
    (process.env.SUPABASE_BUCKET || '').trim() ||
    null
  const projectRef =
    (process.env.SUPABASE_PROJECT_REF || '').trim() || inferProjectRef(url) || null
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim()
  const activeKey = serviceRoleKey || anonKey
  const keyType = serviceRoleKey ? 'service_role' : anonKey ? 'anon' : null

  const checks: CheckResult[] = []

  if (!url) {
    checks.push({
      id: 'supabase:url',
      label: 'Supabase project URL',
      status: 'error',
      detail: 'Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).',
    })
  } else {
    let urlHost: string | null = null
    try {
      const parsed = new URL(url)
      urlHost = parsed.host
    } catch {
      urlHost = null
    }
    checks.push({
      id: 'supabase:url',
      label: 'Supabase project URL',
      status: 'ok',
      detail: urlHost || url,
      meta: {
        projectRef: projectRef,
      },
    })
  }

  if (serviceRoleKey) {
    checks.push({
      id: 'supabase:key:service',
      label: 'Supabase service role key',
      status: 'ok',
      detail: 'Service role key detected.',
      meta: { preview: maskKey(serviceRoleKey) },
    })
  } else if (anonKey) {
    checks.push({
      id: 'supabase:key:anon',
      label: 'Supabase anon key only',
      status: 'warning',
      detail: 'Only anonymous key detected; admin storage actions may fail.',
      meta: { preview: maskKey(anonKey) },
    })
  } else {
    checks.push({
      id: 'supabase:key:none',
      label: 'Supabase key',
      status: 'error',
      detail: 'Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY.',
    })
  }

  if (bucket) {
    checks.push({
      id: 'supabase:bucket',
      label: 'Supabase storage bucket',
      status: 'ok',
      detail: `Bucket "${bucket}" configured.`,
    })
  } else {
    checks.push({
      id: 'supabase:bucket',
      label: 'Supabase storage bucket',
      status: 'warning',
      detail: 'No SUPABASE_STORAGE_BUCKET configured; object listing checks skipped.',
    })
  }

  if (url && activeKey) {
    const headers: Record<string, string> = {
      apikey: activeKey,
      Authorization: `Bearer ${activeKey}`,
    }

    try {
      const response = await fetch(`${url}/storage/v1/bucket`, {
        headers,
        cache: 'no-store',
      })
      const rawBody = await response.text()
      const warning = response.status === 401 || response.status === 403
      const status = toStatus(response.ok, warning)
      const detail = response.ok
        ? `HTTP ${response.status}. Buckets listed.`
        : `HTTP ${response.status}. ${
            warning
              ? 'Unauthorized — check service role key permissions.'
              : response.status === 404
              ? 'Endpoint not found — check Supabase URL.'
              : 'Failed to query bucket list.'
          }`
      checks.push({
        id: 'supabase:listBuckets',
        label: 'List storage buckets',
        status,
        detail,
        meta: {
          status: response.status,
          bodyPreview: formatPreview(rawBody) || '(empty)',
        },
      })
    } catch (error: any) {
      checks.push({
        id: 'supabase:listBuckets',
        label: 'List storage buckets',
        status: 'error',
        detail: `Request failed: ${error?.message || 'unknown error'}`,
      })
    }

    if (bucket) {
      try {
        const bucketResponse = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
          headers,
          cache: 'no-store',
        })
        const body = await bucketResponse.text()
        const status = toStatus(bucketResponse.ok, bucketResponse.status === 404)
        const detail = bucketResponse.ok
          ? `HTTP ${bucketResponse.status}. Bucket metadata available.`
          : `HTTP ${bucketResponse.status}. ${
              bucketResponse.status === 404
                ? 'Bucket missing — verify SUPABASE_STORAGE_BUCKET.'
                : 'Failed to load bucket metadata.'
            }`
        checks.push({
          id: 'supabase:bucketMetadata',
          label: `Bucket "${bucket}" metadata`,
          status,
          detail,
          meta: {
            status: bucketResponse.status,
            bodyPreview: formatPreview(body) || '(empty)',
          },
        })
      } catch (error: any) {
        checks.push({
          id: 'supabase:bucketMetadata',
          label: `Bucket "${bucket}" metadata`,
          status: 'error',
          detail: `Request failed: ${error?.message || 'unknown error'}`,
        })
      }

      try {
        const listResponse = await fetch(
          `${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
          {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ limit: 1, offset: 0 }),
            cache: 'no-store',
          },
        )
        const body = await listResponse.text()
        const warning = listResponse.status === 401 || listResponse.status === 403
        const status = toStatus(listResponse.ok, warning)
        const detail = listResponse.ok
          ? `HTTP ${listResponse.status}. Object list fetched.`
          : `HTTP ${listResponse.status}. ${
              warning
                ? 'Unauthorized — storage list requires elevated key.'
                : 'Failed to list objects.'
            }`
        checks.push({
          id: 'supabase:listObjects',
          label: `Bucket "${bucket}" object list`,
          status,
          detail,
          meta: {
            status: listResponse.status,
            bodyPreview: formatPreview(body) || '(empty)',
          },
        })
      } catch (error: any) {
        checks.push({
          id: 'supabase:listObjects',
          label: `Bucket "${bucket}" object list`,
          status: 'error',
          detail: `Request failed: ${error?.message || 'unknown error'}`,
        })
      }
    }
  }

  const configured = Boolean(url && activeKey)
  let urlHost: string | null = null
  if (url) {
    try {
      urlHost = new URL(url).host
    } catch {
      urlHost = null
    }
  }

  return {
    configured,
    urlHost,
    bucket,
    keyType,
    checks,
  }
}

export async function GET() {
  const env = getBlobEnvironment()
  const health = await blobHealth()
  const ok = env.provider === 'netlify' && env.configured && health.ok && health.mode === 'netlify'
  const message = ok
    ? `Netlify blob store \"${(env as any).store || 'default'}\" is responding.`
    : env.provider !== 'netlify'
    ? 'Storage is running in in-memory fallback mode.'
    : health.ok
    ? 'Netlify storage configured but not returning expected mode.'
    : `Netlify storage health check failed: ${health.reason || 'unknown error'}`

  const checks: CheckResult[] = []
  checks.push({
    id: 'storage:provider',
    label: 'Blob provider',
    status: env.provider === 'netlify' ? 'ok' : 'warning',
    detail:
      env.provider === 'netlify'
        ? `Netlify store "${(env as any).store || 'default'}" configured.`
        : 'Falling back to in-memory storage.',
    meta:
      env.provider === 'netlify'
        ? {
            store: (env as any).store || 'default',
            siteId: (env as any).siteId || '',
          }
        : undefined,
  })

  checks.push({
    id: 'storage:health',
    label: 'Netlify health check',
    status: ok ? 'ok' : health.ok ? 'warning' : 'error',
    detail: message,
    meta: {
      mode: health.mode,
      reason: health.reason || '',
    },
  })

  try {
    const { blobs, hasMore } = await listBlobs({ prefix: 'sessions/', limit: 1 })
    const sample = blobs[0]
    checks.push({
      id: 'storage:listSessions',
      label: 'List session artifacts',
      status: blobs.length > 0 ? 'ok' : 'warning',
      detail:
        blobs.length > 0
          ? `Found ${blobs.length} artifact${blobs.length === 1 ? '' : 's'} in storage.`
          : 'No session artifacts found yet — run a session to create one.',
      meta: {
        hasMore,
        sample: sample?.pathname || null,
      },
    })
  } catch (error: any) {
    checks.push({
      id: 'storage:listSessions',
      label: 'List session artifacts',
      status: 'error',
      detail: `Failed to list session blobs: ${error?.message || 'unknown error'}`,
    })
  }

  const supabase = await gatherSupabaseDiagnostics()

  return NextResponse.json({
    ok,
    env,
    health,
    message,
    checks,
    supabase,
    timestamp: new Date().toISOString(),
  })
}
