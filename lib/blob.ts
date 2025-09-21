import {
  put,
  list as vercelList,
  del as vercelDel,
  type ListBlobResult,
  type ListCommandOptions,
} from '@vercel/blob'
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

const GLOBAL_STORE_KEY = '__dads_interview_blob_fallback__'
const TOKEN_FLAG_KEY = '__dads_interview_blob_token_flagged__'

const globalAny = globalThis as any

if (!globalAny[GLOBAL_STORE_KEY]) {
  globalAny[GLOBAL_STORE_KEY] = new Map<string, MemoryBlobRecord>()
}

const memoryStore: Map<string, MemoryBlobRecord> = globalAny[GLOBAL_STORE_KEY]

function buildInlineDataUrl(contentType: string, buffer: Buffer): string {
  const safeType = contentType && contentType.length ? contentType : 'application/octet-stream'
  const base64 = buffer.toString('base64')
  return `data:${safeType};base64,${base64}`
}

export function getBlobToken() {
  const token = process.env.VERCEL_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN
  if (!token && !globalAny[TOKEN_FLAG_KEY]) {
    globalAny[TOKEN_FLAG_KEY] = true
    flagFox({
      id: 'theory-2-blob-token-missing',
      theory: 2,
      level: 'warn',
      message: 'Blob token missing; falling back to in-memory blob storage.',
    })
  }
  return token
}

export function getFallbackBlob(path: string): (MemoryBlobRecord & { pathname: string }) | undefined {
  const record = memoryStore.get(path)
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
  const access = options.access ?? 'public'
  const token = getBlobToken()


  if (!token) {
    const bufferCopy = Buffer.from(buf)
    const dataUrl = buildInlineDataUrl(contentType, bufferCopy)
    const record: MemoryBlobRecord = {
      buffer: bufferCopy,
      contentType,
      uploadedAt: new Date(),
      size: bufferCopy.byteLength,
      dataUrl,
    }
    memoryStore.set(path, record)
    return {
      url: dataUrl,
      downloadUrl: dataUrl,
    }

  }

  const result = await put(path, buf, {
    access,
    token,
    contentType,
    addRandomSuffix: options.addRandomSuffix,
    cacheControlMaxAge: options.cacheControlMaxAge,
  })

  return { url: result.url, downloadUrl: result.downloadUrl }
}

export async function listBlobs(options: ListCommandOptions | undefined = {}): Promise<ListBlobResult> {
  const token = getBlobToken()

  if (!token) {
    const prefix = options?.prefix ?? ''
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

  const listOptions: ListCommandOptions = { ...(options || {}), token }
  return vercelList(listOptions)
}

export async function deleteBlobsByPrefix(prefix: string): Promise<number> {
  const token = getBlobToken()

  if (!token) {
    return deleteFallbackByPrefix(prefix)
  }

  let cursor: string | undefined
  let removed = 0

  do {
    const { blobs, hasMore, cursor: nextCursor } = await vercelList({
      prefix,
      cursor,
      limit: 100,
      token,
    })

    const urls = blobs
      .map((blob) => blob.url || blob.downloadUrl)
      .filter((url): url is string => typeof url === 'string' && url.length > 0)

    if (urls.length) {
      await vercelDel(urls, { token })
      removed += urls.length
    }

    cursor = hasMore ? nextCursor : undefined
  } while (cursor)

  return removed
}

export async function deleteBlob(pathOrUrl: string): Promise<boolean> {
  const token = getBlobToken()

  if (!token) {
    if (memoryStore.delete(pathOrUrl)) {
      return true
    }
    if (pathOrUrl.startsWith('data:')) {
      return deleteFallbackByUrl(pathOrUrl)
    }
    return false
  }

  if (!pathOrUrl) return false

  if (/^https?:/i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) {
    await vercelDel(pathOrUrl, { token })
    return true
  }

  let cursor: string | undefined
  let deleted = false

  do {
    const { blobs, hasMore, cursor: nextCursor } = await vercelList({
      prefix: pathOrUrl,
      cursor,
      limit: 50,
      token,
    })

    const urls = blobs
      .map((blob) => blob.url || blob.downloadUrl)
      .filter((url): url is string => typeof url === 'string' && url.length > 0)

    if (urls.length) {
      await vercelDel(urls, { token })
      deleted = true
    }

    cursor = hasMore ? nextCursor : undefined
  } while (cursor)

  return deleted
}

export async function blobHealth() {
  const token = getBlobToken()
  if (!token) {
    return { ok: true, mode: 'memory', reason: 'no token' }
  }

  try {

    await vercelList({ limit: 1, token })
    return { ok: true, mode: 'vercel' }
  } catch (e: any) {

    return { ok: false, reason: e?.message || 'error' }
  }
}
