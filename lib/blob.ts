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

const GLOBAL_STORE_KEY = '__dads_interview_blob_fallback__'

const globalAny = globalThis as any

if (!globalAny[GLOBAL_STORE_KEY]) {
  globalAny[GLOBAL_STORE_KEY] = new Map<string, MemoryBlobRecord>()
}

const memoryStore: Map<string, MemoryBlobRecord> = globalAny[GLOBAL_STORE_KEY]

let supabaseConfig: SupabaseConfig | null | undefined
let supabaseClient: SupabaseClient | null | undefined
let supabaseWarningIssued = false

function readSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL || '').trim()
  const key =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ||
    (process.env.SUPABASE_SECRET_KEY || '').trim() ||
    (process.env.SUPABASE_ANON_KEY || '').trim()
  const bucket =
    (process.env.SUPABASE_STORAGE_BUCKET || '').trim() ||
    (process.env.SUPABASE_BUCKET || '').trim()

  if (!url || !key || !bucket) {
    return null
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

async function convertListItemsToBlobs(items: SupabaseListItem[], storage: SupabaseBucketApi): Promise<ListedBlob[]> {
  const mapped: ListedBlob[] = []

  for (const item of items) {
    if (typeof item.name !== 'string' || item.name.length === 0 || item.name.endsWith('/')) continue
    const pathname = item.name
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
      url: publicUrl,
      downloadUrl,
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

  const response = await fetch(`${config.url}/storage/v1/object/list/${config.bucket}`, {
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

export function getBlobToken(): string | undefined {
  const config = getSupabaseConfig()
  if (!config) return undefined
  return 'supabase'
}

export function getFallbackBlob(path: string): (MemoryBlobRecord & { pathname: string }) | undefined {
  const record = memoryStore.get(path) ?? memoryStore.get(normalizePath(path))
  if (!record) return undefined
  return { ...record, pathname: path }
}

export function clearFallbackBlobs() {
  memoryStore.clear()
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

  if (!client || !config) {
    const bufferCopy = Buffer.from(buf)
    const dataUrl = buildInlineDataUrl(contentType, bufferCopy)
    const record: MemoryBlobRecord = {
      buffer: bufferCopy,
      contentType,
      uploadedAt: new Date(),
      size: bufferCopy.byteLength,
      dataUrl,
    }
    memoryStore.set(targetPath, record)
    return {
      url: dataUrl,
      downloadUrl: dataUrl,
    }
  }

  const storage = client.storage.from(config.bucket)
  const cacheControl =
    typeof options.cacheControlMaxAge === 'number' && Number.isFinite(options.cacheControlMaxAge)
      ? `${Math.max(0, Math.trunc(options.cacheControlMaxAge))}`
      : undefined
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

  return { url: publicUrl || downloadUrl, downloadUrl: downloadUrl || publicUrl }
}

export async function listBlobs(options: ListCommandOptions | undefined = {}): Promise<ListBlobResult> {
  const config = getSupabaseConfig()
  const client = getSupabaseClient()

  if (!client || !config) {
    const prefix = options?.prefix ? normalizePath(options.prefix) : ''
    const limit = typeof options?.limit === 'number' ? options.limit : undefined

    const entries = Array.from(memoryStore.entries())
      .filter(([pathname]) => !prefix || pathname.startsWith(prefix))
      .sort((a, b) => b[1].uploadedAt.getTime() - a[1].uploadedAt.getTime())

    const sliced = typeof limit === 'number' ? entries.slice(0, Math.max(limit, 0)) : entries
    return {
      blobs: sliced.map(([pathname, record]) => {
        const url = record.dataUrl
        return {
          pathname,
          url,
          downloadUrl: url,
          uploadedAt: record.uploadedAt,
          size: record.size,
        }
      }),
      hasMore: typeof limit === 'number' ? entries.length > limit : false,
      cursor: undefined,
    }
  }

  const prefix = options?.prefix ? normalizePath(options.prefix) : ''
  const limit = typeof options?.limit === 'number' ? options.limit : 100
  const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0

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

export async function deleteBlob(pathOrUrl: string): Promise<boolean> {
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

  if (!pathOrUrl) return false

  const storage = client.storage.from(config.bucket)

  if (/^https?:/i.test(pathOrUrl)) {
    const extracted = extractSupabasePathFromUrl(pathOrUrl, config.bucket)
    if (!extracted) {
      return false
    }
    const { error } = await storage.remove([extracted])
    if (error) throw new Error(error.message)
    return true
  }

  if (pathOrUrl.startsWith('data:')) {
    return deleteFallbackByUrl(pathOrUrl)
  }

  const normalized = normalizePath(pathOrUrl)
  const { error } = await storage.remove([normalized])
  if (error) throw new Error(error.message)
  return true
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
  return { provider: 'supabase', configured: true as const, bucket: config.bucket }
}
