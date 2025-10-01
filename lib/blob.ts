import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { flagFox } from './foxes'

export type PutBlobOptions = {
  access?: 'public'
  addRandomSuffix?: boolean
  cacheControlMaxAge?: number
}

type MemoryBlobRecord = {
  buffer: Buffer
  contentType: string
  uploadedAt: Date
  size: number
  dataUrl: string
  cacheControl?: string
}

type SupabaseConfig = {
  url: string
  key: string
  bucket: string
}

type SupabaseBucketApi = ReturnType<SupabaseClient['storage']['from']>

type SupabaseListItem = {
  name: string
  id?: string
  updated_at?: string | null
  created_at?: string | null
  last_accessed_at?: string | null
  metadata?: {
    size?: number
  } | null
}

export type ListedBlob = {
  pathname: string
  url: string
  downloadUrl: string
  uploadedAt?: Date
  size?: number
}

export type ListBlobResult = {
  blobs: ListedBlob[]
  hasMore: boolean
  cursor?: string
}

export type ListCommandOptions = {
  prefix?: string
  limit?: number
  cursor?: string
}

type ReadBlobResult = {
  buffer: Buffer
  contentType: string
  etag?: string
  cacheControl?: string
  uploadedAt?: string
  size?: number
}

const GLOBAL_STORE_KEY = '__dads_interview_blob_fallback__'
const BLOB_PROXY_PREFIX = '/api/blob/'
const BLOB_PUBLIC_BASE_ENV_KEYS = [
  'SUPABASE_PUBLIC_BASE_URL',
  'SUPABASE_BLOB_PUBLIC_BASE_URL',
  'BLOB_PUBLIC_BASE_URL',
  'NETLIFY_BLOBS_PUBLIC_BASE_URL',
]

const globalAny = globalThis as any
if (!globalAny[GLOBAL_STORE_KEY]) {
  globalAny[GLOBAL_STORE_KEY] = new Map<string, MemoryBlobRecord>()
}

const memoryStore: Map<string, MemoryBlobRecord> = globalAny[GLOBAL_STORE_KEY]

let supabaseConfig: SupabaseConfig | null | undefined
let supabaseClient: SupabaseClient | null | undefined
let supabaseWarningIssued = false
let supabaseAnonWarningIssued = false

function readEnvWithSource(keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim().length) {
      return { key, value: value.trim() }
    }
  }
  return null
}

function readEnv(keys: string[]): string {
  const result = readEnvWithSource(keys)
  return result ? result.value : ''
}

function readSupabaseConfig(): SupabaseConfig | null {
  const urlResult = readEnvWithSource([
    'SUPABASE_URL',
    'SUPABASE_PROJECT_URL',
    'SUPABASE_API_URL',
    'SUPABASE_SITE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL',
    'NETLIFY_ENV_SUPABASE_URL',
    'NETLIFY_SUPABASE_URL',
    'NETLIFY_ENV_SUPABASE_PROJECT_URL',
    'NETLIFY_SUPABASE_PROJECT_URL',
    'NETLIFY_ENV_SUPABASE_API_URL',
    'NETLIFY_SUPABASE_API_URL',
  ])
  const keyResult = readEnvWithSource([
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE',
    'SUPABASE_SERVICE_ROLE_TOKEN',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SERVICE_API_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ADMIN_KEY',
    'SUPABASE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_SUPABASE_KEY',
    'PUBLIC_SUPABASE_ANON_KEY',
    'NETLIFY_ENV_SUPABASE_SERVICE_ROLE_KEY',
    'NETLIFY_SUPABASE_SERVICE_ROLE_KEY',
    'NETLIFY_ENV_SUPABASE_SERVICE_ROLE',
    'NETLIFY_SUPABASE_SERVICE_ROLE',
    'NETLIFY_ENV_SUPABASE_SERVICE_ROLE_TOKEN',
    'NETLIFY_SUPABASE_SERVICE_ROLE_TOKEN',
    'NETLIFY_ENV_SUPABASE_SECRET_KEY',
    'NETLIFY_SUPABASE_SECRET_KEY',
    'NETLIFY_ENV_SUPABASE_ADMIN_KEY',
    'NETLIFY_SUPABASE_ADMIN_KEY',
    'NETLIFY_ENV_SUPABASE_KEY',
    'NETLIFY_SUPABASE_KEY',
    'NETLIFY_ENV_SUPABASE_ANON_KEY',
    'NETLIFY_SUPABASE_ANON_KEY',
  ])
  const bucketResult = readEnvWithSource([
    'SUPABASE_STORAGE_BUCKET',
    'SUPABASE_BUCKET',
    'SUPABASE_STORAGE_BUCKET_NAME',
    'SUPABASE_STORAGE_BUCKET_ID',
    'NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET',
    'PUBLIC_SUPABASE_STORAGE_BUCKET',
    'NETLIFY_ENV_SUPABASE_STORAGE_BUCKET',
    'NETLIFY_SUPABASE_STORAGE_BUCKET',
    'NETLIFY_ENV_SUPABASE_BUCKET',
    'NETLIFY_SUPABASE_BUCKET',
    'NETLIFY_ENV_SUPABASE_STORAGE_BUCKET_NAME',
    'NETLIFY_SUPABASE_STORAGE_BUCKET_NAME',
    'NETLIFY_ENV_SUPABASE_STORAGE_BUCKET_ID',
    'NETLIFY_SUPABASE_STORAGE_BUCKET_ID',
  ])

  const url = urlResult?.value ?? ''
  const key = keyResult?.value ?? ''
  const bucket = bucketResult?.value ?? ''

  if (!url || !key || !bucket) {
    return null
  }

  if (
    keyResult?.key &&
    !supabaseAnonWarningIssued &&
    keyResult.key.toLowerCase().includes('anon')
  ) {
    supabaseAnonWarningIssued = true
    flagFox({
      id: 'theory-2-storage-anon-key',
      theory: 2,
      level: 'warn',
      message:
        'Supabase storage is configured with an anon/public key; uploads may fail without a service role token.',
      details: { keySource: keyResult.key },
    })
  }

  return { url, key, bucket }
}

function getSupabaseConfig(): SupabaseConfig | null {
  if (typeof supabaseConfig === 'undefined') {
    supabaseConfig = readSupabaseConfig()
  }

  if (!supabaseConfig && !supabaseWarningIssued) {
    supabaseWarningIssued = true
    flagFox({
      id: 'theory-2-storage-missing',
      theory: 2,
      level: 'warn',
      message: 'Supabase storage is not configured; falling back to in-memory blob storage.',
    })
  }

  return supabaseConfig ?? null
}

function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig()
  if (!config) return null

  if (!supabaseClient) {
    supabaseClient = createClient(config.url, config.key, {
      auth: { persistSession: false },
    })
  }

  return supabaseClient
}

function normalizePath(path: string): string {
  if (!path) return ''
  return path.replace(/^\/+/, '')
}

function encodePathForUrl(path: string): string {
  return normalizePath(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function buildInlineDataUrl(contentType: string, buffer: Buffer): string {
  const safeType = contentType && contentType.length ? contentType : 'application/octet-stream'
  const base64 = buffer.toString('base64')
  return `data:${safeType};base64,${base64}`
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

function applyRandomSuffix(path: string): string {
  if (!path) return path
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : ''
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized
  const dotIndex = filename.lastIndexOf('.')
  const suffix = `-${randomSuffix()}`
  if (dotIndex > 0) {
    return `${directory}${filename.slice(0, dotIndex)}${suffix}${filename.slice(dotIndex)}`
  }
  return `${directory}${filename}${suffix}`
}

function getConfiguredPublicBase(): string {
  return readEnv(BLOB_PUBLIC_BASE_ENV_KEYS)
}

function buildProxyUrl(path: string): string {
  const base = getConfiguredPublicBase()
  const encoded = encodePathForUrl(path)
  if (base.length) {
    return `${base.replace(/\/+$/, '')}/${encoded}`
  }
  return `${BLOB_PROXY_PREFIX}${encoded}`
}

function cacheControlFromSeconds(seconds?: number): string | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined
  const safeSeconds = Math.max(0, Math.trunc(seconds))
  return `public, max-age=${safeSeconds}`
}

function deleteFallbackByPrefix(prefix: string) {
  let removed = 0
  for (const key of Array.from(memoryStore.keys())) {
    if (!prefix || key.startsWith(prefix)) {
      memoryStore.delete(key)
      removed += 1
    }
  }
  return removed
}

function deleteFallbackByUrl(url: string) {
  for (const key of Array.from(memoryStore.keys())) {
    const record = memoryStore.get(key)
    if (record && record.dataUrl === url) {
      memoryStore.delete(key)
      return true
    }
  }
  return false
}

async function convertListItemsToBlobs(items: SupabaseListItem[], storage: SupabaseBucketApi): Promise<ListedBlob[]> {
  const mapped: ListedBlob[] = []

  for (const item of items) {
    if (typeof item.name !== 'string' || item.name.length === 0 || item.name.endsWith('/')) continue
    const pathname = item.name
    const proxyUrl = buildProxyUrl(pathname)
    const publicData = storage.getPublicUrl(pathname)
    let publicUrl = publicData?.data?.publicUrl || ''
    let downloadUrl = publicUrl

    if (!downloadUrl) {
      try {
        const signed = await storage.createSignedUrl(pathname, 60 * 60)
        if (!signed.error && signed.data?.signedUrl) {
          downloadUrl = signed.data.signedUrl
          if (!publicUrl) {
            publicUrl = signed.data.signedUrl
          }
        }
      } catch {}
    }

    const timestamp = item.updated_at || item.created_at || item.last_accessed_at || undefined
    const uploadedAt = timestamp ? new Date(timestamp) : undefined
    const size = typeof item.metadata?.size === 'number' ? item.metadata.size : undefined

    mapped.push({
      pathname,
      url: publicUrl || proxyUrl,
      downloadUrl: downloadUrl || proxyUrl,
      uploadedAt,
      size,
    })
  }

  return mapped
}

async function supabaseList(
  config: SupabaseConfig,
  {
    prefix = '',
    limit = 100,
    offset = 0,
  }: {
    prefix?: string
    limit?: number
    offset?: number
  },
): Promise<{ items: SupabaseListItem[]; hasMore: boolean }> {
  const normalizedPrefix = normalizePath(prefix || '')
  const safeLimit = Math.max(1, Math.min(limit ?? 100, 1000))
  const safeOffset = Math.max(0, offset ?? 0)

  const baseUrl = config.url.replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/storage/v1/object/list/${config.bucket}`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prefix: normalizedPrefix,
      limit: safeLimit,
      offset: safeOffset,
      sortBy: { column: 'created_at', order: 'desc' },
      includeMetadata: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`Supabase list failed: ${response.status} ${response.statusText}`)
  }

  const items = (await response.json()) as SupabaseListItem[]
  const hasMore = Array.isArray(items) && items.length === safeLimit
  return { items: Array.isArray(items) ? items : [], hasMore }
}

function extractSupabasePathFromUrl(url: string, bucket: string): string | null {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const bucketIndex = parts.findIndex((part) => part === bucket)
    if (bucketIndex >= 0 && bucketIndex < parts.length - 1) {
      const pathParts = parts.slice(bucketIndex + 1)
      return decodeURIComponent(pathParts.join('/'))
    }
  } catch {
    return null
  }
  return null
}

function extractPathFromUrl(input: string, bucket: string): string | null {
  if (!input) return null
  if (input.startsWith('data:')) return null
  if (!/^https?:/i.test(input)) {
    if (input.startsWith(BLOB_PROXY_PREFIX)) {
      return decodeURIComponent(input.slice(BLOB_PROXY_PREFIX.length))
    }
    return normalizePath(input)
  }

  try {
    const url = new URL(input)
    const base = getConfiguredPublicBase()
    if (base) {
      try {
        const baseUrl = new URL(base)
        if (url.origin === baseUrl.origin) {
          const basePath = baseUrl.pathname.replace(/\/+$/, '')
          if (url.pathname.startsWith(basePath)) {
            const relative = url.pathname.slice(basePath.length).replace(/^\/+/, '')
            return decodeURIComponent(relative)
          }
        }
      } catch {
        const normalizedBase = base.replace(/\/+$/, '')
        if (input.startsWith(`${normalizedBase}/`)) {
          const relative = input.slice(normalizedBase.length + 1)
          return decodeURIComponent(relative)
        }
      }
    }
    const supabasePath = extractSupabasePathFromUrl(input, bucket)
    if (supabasePath) {
      return supabasePath
    }
    if (url.pathname.startsWith(BLOB_PROXY_PREFIX)) {
      return decodeURIComponent(url.pathname.slice(BLOB_PROXY_PREFIX.length))
    }
    return normalizePath(url.pathname)
  } catch {
    return null
  }
}

export function getBlobToken(): string | undefined {
  const config = getSupabaseConfig()
  if (!config) return undefined
  return 'supabase'
}

export function getFallbackBlob(path: string): (MemoryBlobRecord & { pathname: string }) | undefined {
  const record = memoryStore.get(path) ?? memoryStore.get(normalizePath(path))
  if (!record) return undefined
  return { ...record, pathname: normalizePath(path) }
}

export function clearFallbackBlobs() {
  memoryStore.clear()
}

export async function putBlobFromBuffer(
  path: string,
  buf: Buffer,
  contentType: string,
  options: PutBlobOptions = {},
) {
  const config = getSupabaseConfig()
  const client = getSupabaseClient()

  let targetPath = normalizePath(path)
  if (options.addRandomSuffix) {
    targetPath = applyRandomSuffix(targetPath)
  }

  const cacheControl = cacheControlFromSeconds(options.cacheControlMaxAge)

  if (!client || !config) {
    const bufferCopy = Buffer.from(buf)
    const dataUrl = buildInlineDataUrl(contentType, bufferCopy)
    const record: MemoryBlobRecord = {
      buffer: bufferCopy,
      contentType,
      uploadedAt: new Date(),
      size: bufferCopy.byteLength,
      dataUrl,
      cacheControl,
    }
    memoryStore.set(targetPath, record)
    return {
      url: dataUrl,
      downloadUrl: dataUrl,
    }
  }

  const storage = client.storage.from(config.bucket)
  const uploadResult = await storage.upload(targetPath, buf, {
    contentType,
    cacheControl,
    upsert: true,
  })

  if (uploadResult.error) {
    throw new Error(uploadResult.error.message)
  }

  const publicData = storage.getPublicUrl(targetPath)
  let publicUrl = publicData?.data?.publicUrl || ''
  let downloadUrl = publicUrl

  if (!downloadUrl) {
    try {
      const signed = await storage.createSignedUrl(targetPath, 60 * 60)
      if (!signed.error && signed.data?.signedUrl) {
        downloadUrl = signed.data.signedUrl
        if (!publicUrl) {
          publicUrl = signed.data.signedUrl
        }
      }
    } catch {}
  }

  const proxyUrl = buildProxyUrl(targetPath)
  return {
    url: publicUrl || proxyUrl,
    downloadUrl: downloadUrl || proxyUrl,
  }
}

async function listFallbackBlobs({ prefix }: { prefix: string }): Promise<ListedBlob[]> {
  const normalizedPrefix = normalizePath(prefix)
  const results: ListedBlob[] = []
  for (const [pathname, record] of memoryStore.entries()) {
    if (normalizedPrefix && !pathname.startsWith(normalizedPrefix)) continue
    results.push({
      pathname,
      url: record.dataUrl,
      downloadUrl: record.dataUrl,
      uploadedAt: record.uploadedAt,
      size: record.size,
    })
  }
  results.sort((a, b) => a.pathname.localeCompare(b.pathname))
  return results
}

export async function listBlobs(options: ListCommandOptions = {}): Promise<ListBlobResult> {
  const config = getSupabaseConfig()
  const client = getSupabaseClient()

  const prefix = options?.prefix ? normalizePath(options.prefix) : ''
  const limit = typeof options?.limit === 'number' ? Math.max(1, options.limit) : 100
  const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0

  if (!client || !config) {
    const fallback = await listFallbackBlobs({ prefix })
    const sliced = fallback.slice(offset, offset + limit)
    const hasMore = offset + limit < fallback.length
    return {
      blobs: sliced,
      hasMore,
      cursor: hasMore ? String(offset + limit) : undefined,
    }
  }

  const { items, hasMore } = await supabaseList(config, { prefix, limit, offset })
  const storage = client.storage.from(config.bucket)
  const blobs = await convertListItemsToBlobs(items, storage)
  const nextCursor = hasMore ? String(offset + limit) : undefined

  return { blobs, hasMore, cursor: nextCursor }
}

export async function deleteBlobsByPrefix(prefix: string): Promise<number> {
  const config = getSupabaseConfig()
  const client = getSupabaseClient()

  if (!client || !config) {
    return deleteFallbackByPrefix(normalizePath(prefix))
  }

  const sanitizedPrefix = normalizePath(prefix)
  const storage = client.storage.from(config.bucket)
  const pageSize = 100
  let offset = 0
  let removed = 0

  while (true) {
    const { items, hasMore } = await supabaseList(config, { prefix: sanitizedPrefix, limit: pageSize, offset })
    const paths = items
      .map((item) => item.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0 && !name.endsWith('/'))

    if (paths.length) {
      const { error } = await storage.remove(paths)
      if (error) {
        throw new Error(error.message)
      }
      removed += paths.length
    }

    if (!hasMore) {
      break
    }

    offset += pageSize
  }

  return removed
}

export async function deleteBlob(pathOrUrl: string): Promise<boolean> {
  if (!pathOrUrl) return false

  const config = getSupabaseConfig()
  const client = getSupabaseClient()

  if (!client || !config) {
    if (memoryStore.delete(pathOrUrl) || memoryStore.delete(normalizePath(pathOrUrl))) {
      return true
    }
    if (pathOrUrl.startsWith('data:')) {
      return deleteFallbackByUrl(pathOrUrl)
    }
    return false
  }

  if (pathOrUrl.startsWith('data:')) {
    return deleteFallbackByUrl(pathOrUrl)
  }

  const targetPath = extractPathFromUrl(pathOrUrl, config.bucket) || normalizePath(pathOrUrl)
  if (!targetPath) return false

  const storage = client.storage.from(config.bucket)
  const { error } = await storage.remove([targetPath])
  if (error) throw new Error(error.message)
  return true
}

export async function readBlob(pathOrUrl: string): Promise<ReadBlobResult | null> {
  if (!pathOrUrl) return null

  if (pathOrUrl.startsWith('data:')) {
    for (const [pathname, record] of memoryStore.entries()) {
      if (record.dataUrl === pathOrUrl) {
        return {
          buffer: Buffer.from(record.buffer),
          contentType: record.contentType,
          cacheControl: record.cacheControl,
          uploadedAt: record.uploadedAt.toISOString(),
          size: record.size,
        }
      }
    }
    return null
  }

  const config = getSupabaseConfig()
  if (!config) {
    const record = memoryStore.get(pathOrUrl) || memoryStore.get(normalizePath(pathOrUrl))
    if (!record) return null
    return {
      buffer: Buffer.from(record.buffer),
      contentType: record.contentType,
      cacheControl: record.cacheControl,
      uploadedAt: record.uploadedAt.toISOString(),
      size: record.size,
    }
  }

  const targetPath = extractPathFromUrl(pathOrUrl, config.bucket) || normalizePath(pathOrUrl)
  if (!targetPath) return null

  const baseUrl = config.url.replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/storage/v1/object/${config.bucket}/${encodePathForUrl(targetPath)}`, {
    method: 'GET',
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
    },
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Supabase read failed: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const cacheControl = response.headers.get('cache-control') || undefined
  const lastModified = response.headers.get('last-modified')
  const uploadedAt = lastModified ? new Date(lastModified).toISOString() : undefined
  const sizeHeader = response.headers.get('content-length')
  const size = sizeHeader ? Number(sizeHeader) : undefined
  const etag = response.headers.get('etag') || undefined

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    cacheControl,
    uploadedAt,
    size: Number.isFinite(size) ? Number(size) : undefined,
    etag,
  }
}

export async function blobHealth() {
  const config = getSupabaseConfig()
  if (!config) {
    return { ok: true, mode: 'memory', reason: 'no supabase config' }
  }

  try {
    await supabaseList(config, { prefix: '', limit: 1, offset: 0 })
    return { ok: true, mode: 'supabase', bucket: config.bucket }
  } catch (e: any) {
    return { ok: false, mode: 'supabase', reason: e?.message || 'error' }
  }
}

export function getBlobEnvironment() {
  const config = getSupabaseConfig()
  if (!config) {
    return { provider: 'memory', configured: false as const }
  }
  return {
    provider: 'supabase',
    configured: true as const,
    bucket: config.bucket,
    store: config.bucket,
  }
}

export { BLOB_PROXY_PREFIX }
