import { getStore, type Store } from '@netlify/blobs'
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

type NetlifyContext = {
  apiURL?: string
  edgeURL?: string
  token?: string
  siteID?: string
  uncachedEdgeURL?: string
}

type NetlifyConfig = {
  storeName: string
  siteId: string
  token: string
  apiUrl?: string
  edgeUrl?: string
  uncachedEdgeUrl?: string
  consistency?: 'strong' | 'eventual'
}

type CandidateSource = 'env' | 'context' | 'default'

type CandidateSummary = {
  key: string
  source: CandidateSource
  present: boolean
  valuePreview?: string
  note?: string
}

type FieldDiagnostics = {
  present: boolean
  selected?: CandidateSummary
  candidates: CandidateSummary[]
}

type StoreDiagnostics = FieldDiagnostics & {
  defaulted: boolean
}

type TokenDiagnostics = FieldDiagnostics & {
  length?: number
}

type BlobEnvDiagnostics = {
  usingContext: boolean
  contextKeys: string[]
  missing: string[]
  store: StoreDiagnostics
  siteId: FieldDiagnostics
  token: TokenDiagnostics
  optional: {
    apiUrl: FieldDiagnostics
    edgeUrl: FieldDiagnostics
    uncachedEdgeUrl: FieldDiagnostics
    consistency?: string
  }
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

const globalAny = globalThis as any
if (!globalAny[GLOBAL_STORE_KEY]) {
  globalAny[GLOBAL_STORE_KEY] = new Map<string, MemoryBlobRecord>()
}

const memoryStore: Map<string, MemoryBlobRecord> = globalAny[GLOBAL_STORE_KEY]

let netlifyConfig: NetlifyConfig | null | undefined
let netlifyStore: Store | null | undefined
let netlifyWarningIssued = false
let netlifyDiagnostics: BlobEnvDiagnostics | null | undefined

function defaultDiagnostics(): BlobEnvDiagnostics {
  return {
    usingContext: false,
    contextKeys: [],
    missing: ['siteId', 'token'],
    store: {
      present: false,
      defaulted: true,
      selected: undefined,
      candidates: [],
    },
    siteId: {
      present: false,
      selected: undefined,
      candidates: [],
    },
    token: {
      present: false,
      selected: undefined,
      candidates: [],
      length: undefined,
    },
    optional: {
      apiUrl: { present: false, selected: undefined, candidates: [] },
      edgeUrl: { present: false, selected: undefined, candidates: [] },
      uncachedEdgeUrl: { present: false, selected: undefined, candidates: [] },
      consistency: undefined,
    },
  }
}

function maskValue(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

type CandidateInternal = {
  key: string
  source: CandidateSource
  value: string
  note?: string
}

function makeCandidate(
  key: string,
  raw: unknown,
  source: CandidateSource,
  note?: string,
): CandidateInternal {
  return {
    key,
    source,
    value: typeof raw === 'string' ? raw.trim() : '',
    note,
  }
}

function summarizeCandidate(
  candidate: CandidateInternal,
  previewMode: 'store' | 'site' | 'token' | 'url',
): CandidateSummary {
  let valuePreview: string | undefined
  if (candidate.value.length) {
    switch (previewMode) {
      case 'token':
        valuePreview = `${candidate.value.length} chars`
        break
      case 'site':
        valuePreview = maskValue(candidate.value)
        break
      default:
        valuePreview = candidate.value
        break
    }
  }
  return {
    key: candidate.key,
    source: candidate.source,
    present: candidate.value.length > 0,
    valuePreview,
    note: candidate.note,
  }
}

function pickFirstPresent(candidates: CandidateInternal[]): CandidateInternal | undefined {
  return candidates.find((candidate) => candidate.value.length > 0)
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

function parseNetlifyContext(): NetlifyContext | null {
  try {
    const rawEnv = process.env.NETLIFY_BLOBS_CONTEXT || process.env.BLOBS_CONTEXT
    if (rawEnv && rawEnv.trim().length) {
      const decoded = Buffer.from(rawEnv.trim(), 'base64').toString('utf8')
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object') {
        return parsed as NetlifyContext
      }
    }
  } catch {
    // ignore malformed context payloads
  }
  const context = (globalThis as any).netlifyBlobsContext
  if (context && typeof context === 'object') {
    return context as NetlifyContext
  }
  return null
}

function readNetlifyConfig(): { config: NetlifyConfig | null; diagnostics: BlobEnvDiagnostics } {
  const context = parseNetlifyContext()

  const storeName =
    (process.env.NETLIFY_BLOBS_STORE || '').trim() ||
    (process.env.NETLIFY_BLOBS_STORE_NAME || '').trim() ||
    'dads-interview-bot'

  const storeCandidates: CandidateInternal[] = [
    makeCandidate('NETLIFY_BLOBS_STORE', process.env.NETLIFY_BLOBS_STORE, 'env'),
    makeCandidate('NETLIFY_BLOBS_STORE_NAME', process.env.NETLIFY_BLOBS_STORE_NAME, 'env'),
    makeCandidate('default', storeName, 'default', 'fallback store name'),
  ]

  const siteIdCandidates: CandidateInternal[] = [
    makeCandidate('NETLIFY_BLOBS_SITE_ID', process.env.NETLIFY_BLOBS_SITE_ID, 'env'),
    makeCandidate('BLOBS_SITE_ID', process.env.BLOBS_SITE_ID, 'env'),
    makeCandidate('NETLIFY_SITE_ID', process.env.NETLIFY_SITE_ID, 'env'),
    makeCandidate('context.siteID', context?.siteID, 'context'),
  ]

  const tokenCandidates: CandidateInternal[] = [
    makeCandidate('NETLIFY_BLOBS_TOKEN', process.env.NETLIFY_BLOBS_TOKEN, 'env'),
    makeCandidate('BLOBS_TOKEN', process.env.BLOBS_TOKEN, 'env'),
    makeCandidate('NETLIFY_API_TOKEN', process.env.NETLIFY_API_TOKEN, 'env'),
    makeCandidate('context.token', context?.token, 'context'),
  ]

  const edgeUrlCandidates: CandidateInternal[] = [
    makeCandidate('NETLIFY_BLOBS_EDGE_URL', process.env.NETLIFY_BLOBS_EDGE_URL, 'env'),
    makeCandidate('context.edgeURL', context?.edgeURL, 'context'),
  ]

  const apiUrlCandidates: CandidateInternal[] = [
    makeCandidate('NETLIFY_BLOBS_API_URL', process.env.NETLIFY_BLOBS_API_URL, 'env'),
    makeCandidate('context.apiURL', context?.apiURL, 'context'),
  ]

  const uncachedEdgeCandidates: CandidateInternal[] = [
    makeCandidate(
      'NETLIFY_BLOBS_UNCACHED_EDGE_URL',
      process.env.NETLIFY_BLOBS_UNCACHED_EDGE_URL,
      'env',
    ),
    makeCandidate('context.uncachedEdgeURL', context?.uncachedEdgeURL, 'context'),
  ]

  const storePick = pickFirstPresent(storeCandidates) || storeCandidates[storeCandidates.length - 1]
  const siteIdPick = pickFirstPresent(siteIdCandidates)
  const tokenPick = pickFirstPresent(tokenCandidates)
  const edgePick = pickFirstPresent(edgeUrlCandidates)
  const apiPick = pickFirstPresent(apiUrlCandidates)
  const uncachedPick = pickFirstPresent(uncachedEdgeCandidates)

  const consistency =
    (process.env.NETLIFY_BLOBS_CONSISTENCY as 'strong' | 'eventual' | undefined) || undefined

  const diagnostics: BlobEnvDiagnostics = {
    usingContext: Boolean(context),
    contextKeys: context
      ? Object.entries(context)
          .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
          .map(([key]) => key)
      : [],
    missing: [],
    store: {
      present: Boolean(storePick?.value.length),
      defaulted: storePick?.source === 'default',
      selected: storePick ? summarizeCandidate(storePick, 'store') : undefined,
      candidates: storeCandidates.map((candidate) => summarizeCandidate(candidate, 'store')),
    },
    siteId: {
      present: Boolean(siteIdPick?.value.length),
      selected: siteIdPick ? summarizeCandidate(siteIdPick, 'site') : undefined,
      candidates: siteIdCandidates.map((candidate) => summarizeCandidate(candidate, 'site')),
    },
    token: {
      present: Boolean(tokenPick?.value.length),
      selected: tokenPick ? summarizeCandidate(tokenPick, 'token') : undefined,
      candidates: tokenCandidates.map((candidate) => summarizeCandidate(candidate, 'token')),
      length: tokenPick?.value.length || undefined,
    },
    optional: {
      apiUrl: {
        present: Boolean(apiPick?.value.length),
        selected: apiPick ? summarizeCandidate(apiPick, 'url') : undefined,
        candidates: apiUrlCandidates.map((candidate) => summarizeCandidate(candidate, 'url')),
      },
      edgeUrl: {
        present: Boolean(edgePick?.value.length),
        selected: edgePick ? summarizeCandidate(edgePick, 'url') : undefined,
        candidates: edgeUrlCandidates.map((candidate) => summarizeCandidate(candidate, 'url')),
      },
      uncachedEdgeUrl: {
        present: Boolean(uncachedPick?.value.length),
        selected: uncachedPick ? summarizeCandidate(uncachedPick, 'url') : undefined,
        candidates: uncachedEdgeCandidates.map((candidate) => summarizeCandidate(candidate, 'url')),
      },
      consistency,
    },
  }

  if (!diagnostics.siteId.present) diagnostics.missing.push('siteId')
  if (!diagnostics.token.present) diagnostics.missing.push('token')

  const config: NetlifyConfig | null =
    diagnostics.siteId.present && diagnostics.token.present
      ? {
          storeName: storePick?.value || storeName,
          siteId: siteIdPick!.value,
          token: tokenPick!.value,
          apiUrl: apiPick?.value || undefined,
          edgeUrl: edgePick?.value || undefined,
          uncachedEdgeUrl: uncachedPick?.value || undefined,
          consistency,
        }
      : null

  return { config, diagnostics }
}

function getNetlifyConfig(): NetlifyConfig | null {
  if (typeof netlifyConfig === 'undefined' || typeof netlifyDiagnostics === 'undefined') {
    const result = readNetlifyConfig()
    netlifyConfig = result.config
    netlifyDiagnostics = result.diagnostics
  }

  if (!netlifyConfig && !netlifyWarningIssued) {
    netlifyWarningIssued = true
    flagFox({
      id: 'theory-2-storage-missing',
      theory: 2,
      level: 'warn',
      message: 'Netlify blob storage is not configured; falling back to in-memory blob storage.',
    })
  }

  return netlifyConfig ?? null
}

function getBlobEnvDiagnostics(): BlobEnvDiagnostics {
  if (typeof netlifyConfig === 'undefined' || typeof netlifyDiagnostics === 'undefined') {
    const result = readNetlifyConfig()
    netlifyConfig = result.config
    netlifyDiagnostics = result.diagnostics
  }

  return netlifyDiagnostics ?? defaultDiagnostics()
}

function getNetlifyStore(): Store | null {
  const config = getNetlifyConfig()
  if (!config) return null

  if (!netlifyStore) {
    netlifyStore = getStore({
      name: config.storeName,
      siteID: config.siteId,
      token: config.token,
      apiURL: config.apiUrl,
      edgeURL: config.edgeUrl,
      uncachedEdgeURL: config.uncachedEdgeUrl,
      consistency: config.consistency,
    })
  }

  return netlifyStore
}

function buildProxyUrl(path: string): string {
  const base = (process.env.NETLIFY_BLOBS_PUBLIC_BASE_URL || '').trim()
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

function extractPathFromUrl(input: string): string | null {
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
    const base = (process.env.NETLIFY_BLOBS_PUBLIC_BASE_URL || '').trim()
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
    if (url.pathname.startsWith(BLOB_PROXY_PREFIX)) {
      return decodeURIComponent(url.pathname.slice(BLOB_PROXY_PREFIX.length))
    }
    return normalizePath(url.pathname)
  } catch {
    return null
  }
}

export function getBlobToken(): string | undefined {
  const config = getNetlifyConfig()
  if (!config) return undefined
  return 'netlify'
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
  const store = getNetlifyStore()
  let targetPath = normalizePath(path)
  if (options.addRandomSuffix) {
    targetPath = applyRandomSuffix(targetPath)
  }

  const cacheControl = cacheControlFromSeconds(options.cacheControlMaxAge)

  if (!store) {
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

  const uploadedAt = new Date().toISOString()
  await store.set(targetPath, buf, {
    metadata: {
      contentType,
      uploadedAt,
      size: buf.byteLength,
      cacheControl,
      cacheControlMaxAge: options.cacheControlMaxAge,
    },
  })

  const proxyUrl = buildProxyUrl(targetPath)
  return {
    url: proxyUrl,
    downloadUrl: proxyUrl,
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
  const prefix = options?.prefix ? normalizePath(options.prefix) : ''
  const limit = typeof options?.limit === 'number' ? Math.max(1, options.limit) : 100
  const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0

  const store = getNetlifyStore()
  if (!store) {
    const fallback = await listFallbackBlobs({ prefix })
    const sliced = fallback.slice(offset, offset + limit)
    const hasMore = offset + limit < fallback.length
    return {
      blobs: sliced,
      hasMore,
      cursor: hasMore ? String(offset + limit) : undefined,
    }
  }

  const listResult = await store.list({ prefix, directories: false })
  const keys = (listResult?.blobs || [])
    .map((entry) => entry.key)
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
    .sort()

  const slice = keys.slice(offset, offset + limit)

  const blobs: ListedBlob[] = []
  await Promise.all(
    slice.map(async (key) => {
      try {
        const metadataResult = await store.getMetadata(key)
        const metadata = metadataResult?.metadata || {}
        const uploadedRaw = (metadata as any).uploadedAt
        const uploadedAt =
          typeof uploadedRaw === 'string' && uploadedRaw.length
            ? new Date(uploadedRaw)
            : undefined
        const size = Number((metadata as any).size)
        const proxyUrl = buildProxyUrl(key)
        blobs.push({
          pathname: key,
          url: proxyUrl,
          downloadUrl: proxyUrl,
          uploadedAt,
          size: Number.isFinite(size) ? size : undefined,
        })
      } catch {
        const proxyUrl = buildProxyUrl(key)
        blobs.push({ pathname: key, url: proxyUrl, downloadUrl: proxyUrl })
      }
    }),
  )

  blobs.sort((a, b) => a.pathname.localeCompare(b.pathname))
  const hasMore = offset + limit < keys.length

  return {
    blobs,
    hasMore,
    cursor: hasMore ? String(offset + limit) : undefined,
  }
}

export async function deleteBlobsByPrefix(prefix: string): Promise<number> {
  const store = getNetlifyStore()
  const sanitizedPrefix = normalizePath(prefix)

  if (!store) {
    return deleteFallbackByPrefix(sanitizedPrefix)
  }

  const listResult = await store.list({ prefix: sanitizedPrefix, directories: false })
  const keys = (listResult?.blobs || [])
    .map((entry) => entry.key)
    .filter((key): key is string => typeof key === 'string' && key.length > 0)

  let removed = 0
  for (const key of keys) {
    await store.delete(key)
    removed += 1
  }

  return removed
}

export async function deleteBlob(pathOrUrl: string): Promise<boolean> {
  if (!pathOrUrl) return false

  const store = getNetlifyStore()

  if (!store) {
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

  const targetPath = extractPathFromUrl(pathOrUrl) || normalizePath(pathOrUrl)
  if (!targetPath) return false

  await store.delete(targetPath)
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

  const store = getNetlifyStore()
  if (!store) {
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

  const targetPath = extractPathFromUrl(pathOrUrl) || normalizePath(pathOrUrl)
  if (!targetPath) return null

  const result = await store.getWithMetadata(targetPath, { type: 'arrayBuffer' })
  if (!result) return null

  const metadata = result.metadata || {}
  const contentType =
    typeof (metadata as any).contentType === 'string' && (metadata as any).contentType.length
      ? ((metadata as any).contentType as string)
      : 'application/octet-stream'
  const cacheControl =
    typeof (metadata as any).cacheControl === 'string'
      ? ((metadata as any).cacheControl as string)
      : typeof (metadata as any).cacheControlMaxAge === 'number'
      ? cacheControlFromSeconds(Number((metadata as any).cacheControlMaxAge))
      : typeof (metadata as any).cacheControlMaxAge === 'string'
      ? cacheControlFromSeconds(Number((metadata as any).cacheControlMaxAge))
      : undefined
  const uploadedAt =
    typeof (metadata as any).uploadedAt === 'string' ? ((metadata as any).uploadedAt as string) : undefined
  const size = Number((metadata as any).size)

  return {
    buffer: Buffer.from(result.data as ArrayBuffer),
    contentType,
    etag: result.etag,
    cacheControl,
    uploadedAt,
    size: Number.isFinite(size) ? size : undefined,
  }
}

export async function blobHealth() {
  const config = getNetlifyConfig()
  if (!config) {
    return { ok: true, mode: 'memory', reason: 'no netlify blob config' }
  }

  try {
    const store = getNetlifyStore()
    if (!store) {
      return { ok: false, mode: 'netlify', reason: 'failed to initialize store' }
    }
    await store.list({ prefix: '', directories: false })
    return { ok: true, mode: 'netlify', store: config.storeName }
  } catch (error: any) {
    return { ok: false, mode: 'netlify', reason: error?.message || 'error' }
  }
}

export function getBlobEnvironment() {
  const diagnostics = getBlobEnvDiagnostics()
  const config = getNetlifyConfig()
  if (!config) {
    return { provider: 'memory', configured: false as const, diagnostics }
  }
  return {
    provider: 'netlify',
    configured: true as const,
    store: config.storeName,
    siteId: config.siteId,
    diagnostics,
  }
}

export { BLOB_PROXY_PREFIX }
export type { BlobEnvDiagnostics, CandidateSummary }
