// NO FALLBACK: This module crashes if Netlify Blob is unavailable.
import { getStore, type GetStoreOptions, type Store } from '@netlify/blobs'

export type PutBlobOptions = {
  access?: 'public'
  addRandomSuffix?: boolean
  cacheControlMaxAge?: number
}

type HeaderLike =
  | {
      get(name: string): string | null
    }
  | Record<string, string | string[] | undefined>
  | null
  | undefined

type BlobPhase = 'init' | 'upload' | 'read' | 'delete' | 'list'

type BlobConfig = {
  storeName: string
  siteId: string
  token: string
  apiURL?: string
  edgeURL?: string
  uncachedEdgeURL?: string
  consistency?: 'strong' | 'eventual'
}

type BlobErrorReport = {
  phase: BlobPhase
  status?: number
  code?: string
  message: string
  siteId: string
  storeName: string
  target?: string
  timestamp: string
  attempts?: number
}

type ListCommandOptions = {
  prefix?: string
  limit?: number
  cursor?: string
}

type ListedBlob = {
  pathname: string
  url: string
  downloadUrl: string
  uploadedAt?: Date
  size?: number
}

type ListBlobResult = {
  blobs: ListedBlob[]
  hasMore: boolean
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

type NetlifyContext = {
  apiURL?: string
  edgeURL?: string
  token?: string
  siteID?: string
  uncachedEdgeURL?: string
  consistency?: 'strong' | 'eventual'
}

type BlobEnvironment = {
  provider: 'netlify'
  configured: true
  store: string
  siteId: string
  diagnostics: {
    tokenLength: number
    storeProvided: boolean
    debug: boolean
  }
  error: BlobErrorReport | null
  lastSuccessAt?: string
}

const BLOB_PROXY_PREFIX = '/api/blob/'
const DEFAULT_STORE_NAME = 'dads-interview-bot'
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const debugEnabled = String(process.env.DEBUG_BLOBS).toLowerCase() === 'true'

let contextOverrides: NetlifyContext = {}
let cachedStore: Store | null = null
let readinessPromise: Promise<void> | null = null
let lastErrorReport: BlobErrorReport | null = null
let lastSuccessTimestamp: string | undefined

const validatedConfig = validateEnvironment()

logEnvironmentDiagnostics(validatedConfig)

function validateEnvironment(): BlobConfig {
  const rawSiteId = (process.env.NETLIFY_BLOBS_SITE_ID || '').trim()
  if (!rawSiteId) {
    throw new Error('Fatal: NETLIFY_BLOBS_SITE_ID is required for Netlify blob storage.')
  }
  if (!UUID_REGEX.test(rawSiteId)) {
    throw new Error('Fatal: Netlify configuration invalid - NETLIFY_BLOBS_SITE_ID must be a UUID.')
  }

  const rawToken = (process.env.NETLIFY_BLOBS_TOKEN || '').trim()
  if (!rawToken || rawToken.length <= 20) {
    throw new Error('Fatal: Netlify configuration invalid - NETLIFY_BLOBS_TOKEN is missing or too short.')
  }

  const rawStore = (process.env.NETLIFY_BLOBS_STORE || '').trim()
  const storeName = rawStore.length ? rawStore : DEFAULT_STORE_NAME
  if (!rawStore.length) {
    console.warn(
      '[Blob Init] NETLIFY_BLOBS_STORE missing. Defaulting to "dads-interview-bot". Update your environment to silence this warning.',
    )
  }

  const apiURL = (process.env.NETLIFY_BLOBS_API_URL || '').trim() || undefined
  const edgeURL = (process.env.NETLIFY_BLOBS_EDGE_URL || '').trim() || undefined
  const uncachedEdgeURL = (process.env.NETLIFY_BLOBS_UNCACHED_EDGE_URL || '').trim() || undefined
  const consistency = (process.env.NETLIFY_BLOBS_CONSISTENCY || '').trim() || undefined

  return {
    storeName,
    siteId: rawSiteId,
    token: rawToken,
    apiURL,
    edgeURL,
    uncachedEdgeURL,
    consistency: isValidConsistency(consistency) ? (consistency as 'strong' | 'eventual') : undefined,
  }
}

function isValidConsistency(value: string | undefined): value is 'strong' | 'eventual' {
  return value === 'strong' || value === 'eventual'
}

function logEnvironmentDiagnostics(config: BlobConfig) {
  const storeProvided = Boolean((process.env.NETLIFY_BLOBS_STORE || '').trim().length)
  const lines = [
    '[Blob Init]',
    `NETLIFY_BLOBS_SITE_ID: \u2713 valid UUID (${maskSiteId(config.siteId)})`,
    `NETLIFY_BLOBS_TOKEN: \u2713 present (length ${config.token.length})`,
    `NETLIFY_BLOBS_STORE: ${storeProvided ? '\u2713 ' + config.storeName : `! defaulting to ${config.storeName}`}`,
  ]
  console.info(lines.join('\n'))
  if (debugEnabled) {
    console.debug('[Blob Init] DEBUG_BLOBS mode enabled; verbose Netlify blob logging active.')
  }
}

function maskSiteId(siteId: string): string {
  if (!siteId || siteId.length < 4) return siteId
  return `****${siteId.slice(-4)}`
}

function maskToken(token: string): string {
  if (!token) return ''
  if (token.length <= 8) return `${token.slice(0, 2)}**`
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

function getActiveConfig(): BlobConfig {
  const merged: BlobConfig = {
    ...validatedConfig,
    ...contextOverrides,
    token: validatedConfig.token,
    siteId: validatedConfig.siteId,
    storeName: validatedConfig.storeName,
  }
  return merged
}

function resetStore(reason: string) {
  if (cachedStore) {
    console.info(`[Blob init] Resetting cached store due to: ${reason}`)
  }
  cachedStore = null
  readinessPromise = null
}

function sanitizeContext(input: Partial<NetlifyContext> | null | undefined): NetlifyContext | null {
  if (!input || typeof input !== 'object') return null
  const cleaned: NetlifyContext = {}
  const keys: (keyof NetlifyContext)[] = [
    'apiURL',
    'edgeURL',
    'token',
    'siteID',
    'uncachedEdgeURL',
    'consistency',
  ]
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      cleaned[key] = value.trim()
    }
  }
  if (cleaned.consistency && !isValidConsistency(cleaned.consistency)) {
    delete cleaned.consistency
  }
  return Object.keys(cleaned).length ? cleaned : null
}

export function setNetlifyBlobContext(context: Partial<NetlifyContext> | null | undefined): boolean {
  const sanitized = sanitizeContext(context)
  if (!sanitized) return false

  if (sanitized.siteID && sanitized.siteID !== validatedConfig.siteId) {
    throw new Error(
      `Fatal: Netlify configuration invalid - header site ID ${sanitized.siteID} does not match NETLIFY_BLOBS_SITE_ID ${validatedConfig.siteId}.`,
    )
  }
  if (sanitized.token && sanitized.token !== validatedConfig.token) {
    throw new Error('Fatal: Netlify configuration invalid - request token differs from configured token.')
  }

  const nextContext: NetlifyContext = { ...contextOverrides }
  let changed = false
  for (const [key, value] of Object.entries(sanitized) as [keyof NetlifyContext, string][]) {
    if (value && nextContext[key] !== value) {
      nextContext[key] = value
      changed = true
    }
  }
  if (!changed) return true
  contextOverrides = nextContext
  resetStore('updated Netlify context overrides')
  return true
}

export function primeNetlifyBlobContextFromHeaders(headers: HeaderLike): boolean {
  if (!headers) return false
  const candidates: NetlifyContext = {}
  const siteIdHeader = pickFirstHeader(headers, [
    'x-nf-site-id',
    'x-netlify-site-id',
    'x-nf-blobs-site-id',
    'x-netlify-blobs-site-id',
  ])
  if (siteIdHeader) candidates.siteID = siteIdHeader

  const tokenHeader = pickFirstHeader(headers, [
    'x-nf-token',
    'x-netlify-token',
    'x-nf-blobs-token',
    'x-netlify-blobs-token',
  ])
  if (tokenHeader) candidates.token = tokenHeader

  const apiUrlHeader = pickFirstHeader(headers, ['x-nf-blobs-api-url', 'x-netlify-blobs-api-url'])
  if (apiUrlHeader) candidates.apiURL = apiUrlHeader

  const edgeUrlHeader = pickFirstHeader(headers, ['x-nf-blobs-edge-url', 'x-netlify-blobs-edge-url'])
  if (edgeUrlHeader) candidates.edgeURL = edgeUrlHeader

  const uncachedEdgeUrlHeader = pickFirstHeader(headers, [
    'x-nf-blobs-uncached-edge-url',
    'x-netlify-blobs-uncached-edge-url',
  ])
  if (uncachedEdgeUrlHeader) candidates.uncachedEdgeURL = uncachedEdgeUrlHeader

  const consistencyHeader = pickFirstHeader(headers, ['x-nf-blobs-consistency'])
  if (consistencyHeader) candidates.consistency = consistencyHeader as 'strong' | 'eventual'

  return setNetlifyBlobContext(candidates)
}

function pickFirstHeader(headers: HeaderLike, names: string[]): string | undefined {
  for (const name of names) {
    const value = getHeaderValue(headers, name)
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function getHeaderValue(headers: HeaderLike, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as any).get === 'function') {
    try {
      const value = (headers as any).get(name)
      if (typeof value === 'string') return value
    } catch {
      // ignore header read errors
    }
  }
  if (typeof headers === 'object' && !Array.isArray(headers)) {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
    if (!entry) return undefined
    const value = entry[1]
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const candidate = value.find((item) => typeof item === 'string')
      return candidate
    }
    if (value != null) return String(value)
  }
  return undefined
}

function ensureStore(): Store {
  if (cachedStore) return cachedStore
  const config = getActiveConfig()
  logStoreConfiguration(config)
  try {
    const options: GetStoreOptions = {
      name: config.storeName,
      siteID: config.siteId,
      token: config.token,
    }
    if (config.apiURL) options.apiURL = config.apiURL
    if (config.edgeURL) options.edgeURL = config.edgeURL
    if (config.uncachedEdgeURL) options.uncachedEdgeURL = config.uncachedEdgeURL
    if (config.consistency) options.consistency = config.consistency

    cachedStore = getStore(options)
    console.info(`[Blob init] Connected to Netlify blob store "${config.storeName}" for site ${maskSiteId(config.siteId)}.`)
    return cachedStore
  } catch (error) {
    const report = logStructuredError('init', error, config)
    throw fatalError(report, error)
  }
}

function logStoreConfiguration(config: BlobConfig) {
  console.info('[Blob init] Using Netlify configuration', {
    storeName: config.storeName,
    siteId: maskSiteId(config.siteId),
    token: maskToken(config.token),
    apiURL: config.apiURL || null,
    edgeURL: config.edgeURL || null,
    uncachedEdgeURL: config.uncachedEdgeURL || null,
    consistency: config.consistency || null,
  })
}

function fatalError(report: BlobErrorReport, error: unknown): Error {
  const message = `Fatal: Netlify blob ${report.phase} failed - ${report.message}`
  const err = new Error(message, { cause: error }) as Error & {
    status?: number
    code?: string
    blobDetails?: BlobErrorReport
  }
  err.status = report.status
  err.code = report.code
  err.blobDetails = report
  return err
}

async function executeWithRetries<T>(
  phase: BlobPhase,
  target: string | undefined,
  operation: () => Promise<T>,
  onSuccess?: (result: T) => void,
): Promise<T> {
  const config = getActiveConfig()
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (debugEnabled) {
        console.debug(`[Blob ${phase}] Attempt ${attempt}${target ? ` for ${target}` : ''}`)
      }
      const result = await operation()
      lastErrorReport = null
      lastSuccessTimestamp = new Date().toISOString()
      console.info(
        `[Blob ${phase}] Success${target ? ` (${target})` : ''}${attempt > 1 ? ` after ${attempt} attempts` : ''}.`,
      )
      if (onSuccess) onSuccess(result)
      return result
    } catch (error) {
      const report = logStructuredError(phase, error, config, target, attempt)
      if (report.status === 401 || report.status === 403) {
        throw new Error('Fatal: Netlify configuration invalid.', { cause: error })
      }
      if (report.status === 429 || report.status === 500) {
        if (attempt < maxAttempts) {
          const delayMs = 250 * attempt
          if (debugEnabled) {
            console.debug(`[Blob ${phase}] Retrying after ${delayMs}ms due to status ${report.status}.`)
          }
          await delay(delayMs)
          continue
        }
      }
      throw fatalError(report, error)
    }
  }
  throw new Error('Fatal: unexpected blob retry exhaustion.')
}

function logStructuredError(
  phase: BlobPhase,
  error: unknown,
  config: BlobConfig,
  target?: string,
  attempt?: number,
): BlobErrorReport {
  const status = extractStatus(error)
  const code = extractCode(error)
  const message = extractMessage(error) || 'Unknown Netlify blob error'
  const report: BlobErrorReport = {
    phase,
    status,
    code,
    message,
    siteId: maskSiteId(config.siteId),
    storeName: config.storeName,
    target,
    timestamp: new Date().toISOString(),
    attempts: attempt,
  }
  lastErrorReport = report

  if (debugEnabled) {
    const responseHeaders = extractResponseHeaders(error)
    const responseBody = extractResponseBodySnippet(error)
    const debugPayload = {
      ...report,
      debug: {
        responseHeaders,
        responseBody,
      },
    }
    console.error(JSON.stringify(debugPayload))
  } else {
    console.error(JSON.stringify(report))
  }
  return report
}

function extractStatus(error: any): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  return [error.status, error.statusCode, error.statusText, error.response?.status]
    .map((candidate) => {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
      if (typeof candidate === 'string') {
        const parsed = Number.parseInt(candidate, 10)
        if (Number.isFinite(parsed)) return parsed
      }
      return undefined
    })
    .find((value) => typeof value === 'number')
}

function extractCode(error: any): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = error.code || error.name
  return typeof code === 'string' && code.length ? code : undefined
}

function extractMessage(error: any): string | undefined {
  if (!error) return undefined
  if (typeof error === 'string') return error
  if (typeof error.message === 'string') return error.message
  if (typeof error.toString === 'function') return error.toString()
  return undefined
}

function extractResponseHeaders(error: any): Record<string, string> | undefined {
  try {
    const headers = error?.response?.headers
    if (!headers) return undefined
    if (typeof headers.forEach === 'function') {
      const result: Record<string, string> = {}
      headers.forEach((value: string, key: string) => {
        result[key] = value
      })
      return result
    }
    if (typeof headers === 'object') {
      return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]),
      )
    }
  } catch {
    // ignore header extraction failures
  }
  return undefined
}

function extractResponseBodySnippet(error: any): string | undefined {
  const body = error?.response?.body || error?.responseBody || error?.body
  if (!body) return undefined
  if (typeof body === 'string') return body.slice(0, 500)
  if (body instanceof Buffer) return body.toString('utf8', 0, 500)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer).toString('utf8', 0, 500)
  return undefined
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizePath(path: string): string {
  if (!path) return ''
  return path.replace(/^\/+/, '')
}

function encodePathForUrl(path: string): string {
  return normalizePath(path)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function applyRandomSuffix(path: string): string {
  const normalized = normalizePath(path)
  if (!normalized) return normalized
  const lastSlash = normalized.lastIndexOf('/')
  const directory = lastSlash >= 0 ? `${normalized.slice(0, lastSlash + 1)}` : ''
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized
  const dotIndex = filename.lastIndexOf('.')
  const suffix = `-${Math.random().toString(36).slice(2, 10)}`
  if (dotIndex > 0) {
    return `${directory}${filename.slice(0, dotIndex)}${suffix}${filename.slice(dotIndex)}`
  }
  return `${directory}${filename}${suffix}`
}

function cacheControlFromSeconds(seconds?: number): string | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined
  const safeSeconds = Math.max(0, Math.trunc(seconds))
  return `public, max-age=${safeSeconds}`
}

function buildProxyUrl(path: string): string {
  const base = (process.env.NETLIFY_BLOBS_PUBLIC_BASE_URL || '').trim()
  const encoded = encodePathForUrl(path)
  if (base.length) {
    return `${base.replace(/\/+$/, '')}/${encoded}`
  }
  return `${BLOB_PROXY_PREFIX}${encoded}`
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

async function ensureReadiness(): Promise<void> {
  const store = ensureStore()
  await executeWithRetries('init', 'readiness', async () => {
    await store.list({ limit: 1, directories: false })
    return true
  })
}

export function getBlobToken(): string | undefined {
  return validatedConfig.token
}

export async function assertBlobReady(): Promise<void> {
  if (!readinessPromise) {
    readinessPromise = ensureReadiness()
  }
  await readinessPromise
}

if (typeof process !== 'undefined') {
  assertBlobReady().catch((error) => {
    console.error('Fatal: Cannot initialize Netlify blob store during startup.', error)
    setImmediate(() => {
      throw error
    })
  })
}

export async function putBlobFromBuffer(
  path: string,
  buf: Buffer,
  contentType: string,
  options: PutBlobOptions = {},
) {
  const store = ensureStore()
  let targetPath = normalizePath(path)
  if (options.addRandomSuffix) {
    targetPath = applyRandomSuffix(targetPath)
  }

  const cacheControl = cacheControlFromSeconds(options.cacheControlMaxAge)
  const uploadedAt = new Date().toISOString()

  await assertBlobReady()

  await executeWithRetries('upload', targetPath, async () => {
    await store.set(targetPath, buf, {
      metadata: {
        contentType,
        uploadedAt,
        size: buf.byteLength,
        cacheControl,
        cacheControlMaxAge: options.cacheControlMaxAge,
      },
    })
    return true
  })

  const proxyUrl = buildProxyUrl(targetPath)
  return {
    url: proxyUrl,
    downloadUrl: proxyUrl,
  }
}

export async function listBlobs(options: ListCommandOptions = {}): Promise<ListBlobResult> {
  const store = ensureStore()
  await assertBlobReady()
  const prefix = options.prefix ? normalizePath(options.prefix) : ''
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) ? Math.max(1, options.limit) : 100
  const cursor = options.cursor

  const listResult = await executeWithRetries('list', prefix || undefined, async () => {
    return store.list({ prefix, limit, cursor, directories: false })
  })

  const blobs = (listResult?.blobs || []).map((entry: any) => {
    const pathname = typeof entry.key === 'string' && entry.key.length ? entry.key : normalizePath(entry.pathname || '')
    const uploadedAt = entry.uploadedAt ? new Date(entry.uploadedAt) : undefined
    const size = typeof entry.size === 'number' ? entry.size : undefined
    const proxyUrl = buildProxyUrl(pathname)
    return {
      pathname,
      url: proxyUrl,
      downloadUrl: proxyUrl,
      uploadedAt,
      size,
    }
  })

  return {
    blobs,
    hasMore: Boolean(listResult?.hasMore),
    cursor: listResult?.cursor,
  }
}

export async function deleteBlobsByPrefix(prefix: string): Promise<number> {
  const store = ensureStore()
  await assertBlobReady()
  const sanitizedPrefix = normalizePath(prefix)
  const listResult = await executeWithRetries('list', sanitizedPrefix || undefined, async () => {
    return store.list({ prefix: sanitizedPrefix, directories: false })
  })
  const keys = (listResult?.blobs || [])
    .map((entry: any) => entry.key as string)
    .filter((key): key is string => typeof key === 'string' && key.length > 0)

  let deleted = 0
  for (const key of keys) {
    await executeWithRetries('delete', key, async () => {
      await store.delete(key)
      return true
    })
    deleted += 1
  }
  return deleted
}

export async function deleteBlob(pathOrUrl: string): Promise<boolean> {
  if (!pathOrUrl) return false
  const store = ensureStore()
  await assertBlobReady()
  const targetPath = extractPathFromUrl(pathOrUrl)
  if (!targetPath) return false
  await executeWithRetries('delete', targetPath, async () => {
    await store.delete(targetPath)
    return true
  })
  return true
}

export async function readBlob(pathOrUrl: string): Promise<ReadBlobResult | null> {
  if (!pathOrUrl) return null
  const store = ensureStore()
  await assertBlobReady()
  const targetPath = extractPathFromUrl(pathOrUrl)
  if (!targetPath) return null

  const result = await executeWithRetries('read', targetPath, async () => {
    return store.getWithMetadata(targetPath, { type: 'arrayBuffer' })
  })

  if (!result) {
    console.info(`[Blob read] ${targetPath} not found.`)
    return null
  }

  const metadata = result.metadata || {}
  const contentType =
    typeof (metadata as any).contentType === 'string' && (metadata as any).contentType.length
      ? ((metadata as any).contentType as string)
      : 'application/octet-stream'
  const cacheControl = typeof (metadata as any).cacheControl === 'string' ? ((metadata as any).cacheControl as string) : undefined
  const uploadedAt = typeof (metadata as any).uploadedAt === 'string' ? ((metadata as any).uploadedAt as string) : undefined
  const sizeValue = Number((metadata as any).size)
  const size = Number.isFinite(sizeValue) ? sizeValue : undefined

  return {
    buffer: Buffer.from(result.data as ArrayBuffer),
    contentType,
    etag: result.etag,
    cacheControl,
    uploadedAt,
    size,
  }
}

export async function blobHealth() {
  try {
    await assertBlobReady()
    const config = getActiveConfig()
    return {
      ok: true,
      store: config.storeName,
      siteId: maskSiteId(config.siteId),
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    const details = lastErrorReport || {
      phase: 'init',
      status: undefined,
      code: undefined,
      message: extractMessage(error) || 'Cannot initialize Netlify blob store',
      siteId: maskSiteId(validatedConfig.siteId),
      storeName: validatedConfig.storeName,
      timestamp: new Date().toISOString(),
    }
    return {
      ok: false,
      error: 'Cannot initialize Netlify blob store',
      details,
    }
  }
}

export function getBlobEnvironment(): BlobEnvironment {
  return {
    provider: 'netlify',
    configured: true,
    store: validatedConfig.storeName,
    siteId: validatedConfig.siteId,
    diagnostics: {
      tokenLength: validatedConfig.token.length,
      storeProvided: Boolean((process.env.NETLIFY_BLOBS_STORE || '').trim().length),
      debug: debugEnabled,
    },
    error: lastErrorReport,
    lastSuccessAt: lastSuccessTimestamp,
  }
}

export type { ListBlobResult, ListCommandOptions, ListedBlob, ReadBlobResult }
export { BLOB_PROXY_PREFIX }
