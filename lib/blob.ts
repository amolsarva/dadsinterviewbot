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
  token?: string
  apiUrl?: string
  edgeUrl?: string
  uncachedEdgeUrl?: string
  consistency?: 'strong' | 'eventual'
  siteSlug?: string
  siteName?: string
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

type BlobErrorDetails = {
  action: string
  target?: string
  store?: string
  siteId?: string
  siteSlug?: string
  siteName?: string
  tokenSource?: string
  tokenLength?: number
  usingContext?: boolean
  contextKeys?: string[]
  missing?: string[]
  status?: number
  code?: string
  requestId?: string
  responseBodySnippet?: string
  originalMessage?: string
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
const NETLIFY_API_BASE_URL = 'https://api.netlify.com'
const CANONICAL_SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const globalAny = globalThis as any
if (!globalAny[GLOBAL_STORE_KEY]) {
  globalAny[GLOBAL_STORE_KEY] = new Map<string, MemoryBlobRecord>()
}

const memoryStore: Map<string, MemoryBlobRecord> = globalAny[GLOBAL_STORE_KEY]

let netlifyConfig: NetlifyConfig | null | undefined
let netlifyStore: Store | null | undefined
let netlifyWarningIssued = false
let netlifyDiagnostics: BlobEnvDiagnostics | null | undefined
let netlifySiteResolution: Promise<SiteResolution | null> | null = null
let netlifySiteResolutionSlug: string | null = null
let netlifySiteResolutionNotified = false

type SiteResolution = {
  slug: string
  siteId: string
  siteName?: string
}

function defaultDiagnostics(): BlobEnvDiagnostics {
  return {
    usingContext: false,
    contextKeys: [],
    missing: ['siteId'],
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

function truncateForDiagnostics(value: string, limit = 240) {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned.length) return ''
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, limit - 1)}…`
}

function looksLikeSiteId(value: string): boolean {
  return CANONICAL_SITE_ID.test(value.trim())
}

async function resolveSiteId(config: NetlifyConfig): Promise<SiteResolution | null> {
  const slug = config.siteId.trim()
  if (!slug.length) return null
  const token = config.token?.trim() ?? ''
  if (!token.length) return null
  const base = (config.apiUrl || '').trim() || NETLIFY_API_BASE_URL
  const url = new URL(`/api/v1/sites/${encodeURIComponent(slug)}`, base)

  if (typeof fetch !== 'function') {
    throw new Error('Global fetch implementation is required to resolve Netlify site slugs.')
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'user-agent': 'dads-interview-bot/slug-resolver',
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    let snippet: string | undefined
    try {
      const text = await response.text()
      if (text && text.trim().length) {
        snippet = truncateForDiagnostics(text, 160)
      }
    } catch {}
    const summary = snippet ? `: ${snippet}` : ''
    throw new Error(`Failed to resolve Netlify site slug "${slug}" (status ${response.status})${summary}`)
  }

  let payload: any
  try {
    payload = await response.json()
  } catch (error) {
    throw new Error(`Resolved Netlify site slug "${slug}" but failed to parse response JSON: ${(error as Error).message}`)
  }

  const rawId = typeof payload?.id === 'string' ? payload.id.trim() : ''
  if (!looksLikeSiteId(rawId)) {
    throw new Error(
      `Netlify site lookup for slug "${slug}" returned an unexpected site identifier. Expected a UUID but received "${rawId}".`,
    )
  }

  const siteName =
    typeof payload?.name === 'string' && payload.name.trim().length
      ? payload.name.trim()
      : typeof payload?.site_name === 'string' && payload.site_name.trim().length
      ? payload.site_name.trim()
      : undefined

  return { slug, siteId: rawId, siteName }
}

async function ensureCanonicalSiteId(config: NetlifyConfig): Promise<NetlifyConfig> {
  if (looksLikeSiteId(config.siteId)) {
    if (!config.siteSlug) {
      return config
    }
    return { ...config }
  }

  if (!config.token?.trim()) {
    throw new Error(
      `NETLIFY_BLOBS_SITE_ID is set to "${config.siteId}", which looks like a site slug. Provide the Site ID (UUID) from Netlify or set NETLIFY_BLOBS_TOKEN so the slug can be resolved automatically.`,
    )
  }

  if (!netlifySiteResolution || netlifySiteResolutionSlug !== config.siteId) {
    netlifySiteResolutionSlug = config.siteId
    netlifySiteResolution = resolveSiteId(config).catch((error) => {
      netlifySiteResolution = null
      throw error
    })
  }

  const resolution = await netlifySiteResolution
  if (!resolution) {
    throw new Error(
      `NETLIFY_BLOBS_SITE_ID is set to "${config.siteId}", which looks like a site slug. Provide the Site ID (UUID) from Netlify or ensure the slug is accessible to this token.`,
    )
  }

  const updated: NetlifyConfig = {
    ...config,
    siteId: resolution.siteId,
    siteSlug: resolution.slug,
    siteName: resolution.siteName,
  }

  netlifyConfig = updated
  updateDiagnosticsForResolution(resolution)
  notifySiteResolution(resolution)

  return updated
}

function updateDiagnosticsForResolution(resolution: SiteResolution) {
  if (!netlifyDiagnostics) return
  const noteParts = [`resolved slug "${resolution.slug}" to site ID ${maskValue(resolution.siteId)}`]
  if (resolution.siteName && resolution.siteName !== resolution.slug) {
    noteParts.push(`(${resolution.siteName})`)
  }
  const note = noteParts.join(' ')
  if (netlifyDiagnostics.siteId.selected) {
    netlifyDiagnostics.siteId.selected = {
      ...netlifyDiagnostics.siteId.selected,
      valuePreview: maskValue(resolution.siteId),
      note: netlifyDiagnostics.siteId.selected.note
        ? `${netlifyDiagnostics.siteId.selected.note}; ${note}`
        : note,
    }
  }
  netlifyDiagnostics.siteId.present = true
  netlifyDiagnostics.missing = netlifyDiagnostics.missing.filter((entry) => entry !== 'siteId')
}

function notifySiteResolution(resolution: SiteResolution) {
  if (netlifySiteResolutionNotified) return
  netlifySiteResolutionNotified = true
  flagFox({
    id: 'netlify-site-slug-resolved',
    theory: 2,
    level: 'info',
    message: `Resolved Netlify site slug "${resolution.slug}" to site ID ${maskValue(resolution.siteId)} for blob storage.`,
    details: {
      siteSlug: resolution.slug,
      siteId: maskValue(resolution.siteId),
      siteName: resolution.siteName,
    },
  })
}

function extractStatusCode(error: any): number | undefined {
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof error?.statusCode === 'number'
      ? error.statusCode
      : typeof error?.response?.status === 'number'
      ? error.response.status
      : typeof error?.response?.statusCode === 'number'
      ? error.response.statusCode
      : undefined
  if (typeof status === 'number' && Number.isFinite(status)) return status
  return undefined
}

function extractErrorCode(error: any): string | undefined {
  const code =
    typeof error?.code === 'string'
      ? error.code
      : typeof error?.error?.code === 'string'
      ? error.error.code
      : typeof error?.response?.code === 'string'
      ? error.response.code
      : undefined
  return code && code.trim().length ? code.trim() : undefined
}

function extractRequestId(error: any): string | undefined {
  const headerValue = (() => {
    const headers = error?.response?.headers
    if (!headers) return undefined
    if (typeof headers.get === 'function') {
      try {
        const value = headers.get('x-nf-request-id')
        if (typeof value === 'string' && value.trim().length) return value.trim()
      } catch {}
    }
    const raw = (headers as any)['x-nf-request-id'] || (headers as any)['X-Nf-Request-Id']
    if (typeof raw === 'string' && raw.trim().length) return raw.trim()
    return undefined
  })()
  const direct =
    typeof error?.requestId === 'string'
      ? error.requestId
      : typeof error?.response?.requestId === 'string'
      ? error.response.requestId
      : undefined
  const value = headerValue || direct
  return value && value.trim().length ? value.trim() : undefined
}

async function extractResponseBodySnippet(error: any): Promise<string | undefined> {
  const direct =
    typeof error?.body === 'string'
      ? error.body
      : typeof error?.responseBody === 'string'
      ? error.responseBody
      : typeof error?.response?.body === 'string'
      ? error.response.body
      : undefined
  if (typeof direct === 'string' && direct.trim().length) {
    return truncateForDiagnostics(direct)
  }

  const data =
    typeof error?.data === 'string'
      ? error.data
      : typeof error?.response?.data === 'string'
      ? error.response.data
      : undefined
  if (typeof data === 'string' && data.trim().length) {
    return truncateForDiagnostics(data)
  }

  const jsonData = error?.response?.data
  if (jsonData && typeof jsonData === 'object') {
    try {
      const serialized = JSON.stringify(jsonData)
      if (serialized) return truncateForDiagnostics(serialized)
    } catch {}
  }

  const response = error?.response
  if (response && typeof response.text === 'function') {
    try {
      const text = await response.text()
      if (typeof text === 'string' && text.trim().length) {
        return truncateForDiagnostics(text)
      }
    } catch {}
  }
  if (response && typeof response.json === 'function') {
    try {
      const json = await response.json()
      if (json) {
        const serialized = JSON.stringify(json)
        if (serialized) return truncateForDiagnostics(serialized)
      }
    } catch {}
  }

  return undefined
}

async function buildBlobError(
  error: any,
  context: { action: string; target?: string; config?: NetlifyConfig | null },
): Promise<Error> {
  const diagnostics = getBlobEnvDiagnostics()
  const config = context.config ?? getNetlifyConfig()

  const status = extractStatusCode(error)
  const code = extractErrorCode(error)
  const requestId = extractRequestId(error)
  const bodySnippet = await extractResponseBodySnippet(error)
  const originalMessage = typeof error?.message === 'string' ? error.message : undefined

  const details: BlobErrorDetails = {
    action: context.action,
    target: context.target,
    store: config?.storeName,
    siteId: config?.siteId,
    siteSlug: config?.siteSlug,
    siteName: config?.siteName,
    tokenSource: diagnostics.token.selected?.key,
    tokenLength: diagnostics.token.length,
    usingContext: diagnostics.usingContext,
    contextKeys: diagnostics.contextKeys,
    missing: diagnostics.missing,
    status,
    code,
    requestId,
    responseBodySnippet: bodySnippet,
    originalMessage,
  }

  const summaryParts: string[] = []
  if (typeof status === 'number') summaryParts.push(`status ${status}`)
  if (code) summaryParts.push(`code ${code}`)
  if (requestId) summaryParts.push(`request ${requestId}`)
  const maskedSite = config?.siteId ? maskValue(config.siteId) : undefined
  const location =
    config?.storeName && maskedSite
      ? `Netlify store "${config.storeName}" (site ${maskedSite})`
      : config?.storeName
      ? `Netlify store "${config.storeName}"`
      : 'Netlify blob store'
  const summary = summaryParts.length ? ` (${summaryParts.join(', ')})` : ''

  const message = `Failed to ${context.action}${
    context.target ? ` "${context.target}"` : ''
  } in ${location}${summary}. See attached blob error details for more context.`

  const wrapped = new Error(message)
  ;(wrapped as any).blobDetails = details
  if (error && typeof error === 'object') {
    ;(wrapped as any).cause = error
  }
  return wrapped
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

  const config: NetlifyConfig | null =
    diagnostics.siteId.present
      ? {
          storeName: storePick?.value || storeName,
          siteId: siteIdPick!.value,
          token: tokenPick?.value || undefined,
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

async function getNetlifyStore(): Promise<Store | null> {
  const baseConfig = getNetlifyConfig()
  if (!baseConfig) return null

  const config = await ensureCanonicalSiteId(baseConfig)

  if (!netlifyStore) {
    netlifyStore = getStore({
      name: config.storeName,
      siteID: config.siteId,
       token: config.token,
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
  const store = await getNetlifyStore()
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
  try {
    await store.set(targetPath, buf, {
      metadata: {
        contentType,
        uploadedAt,
        size: buf.byteLength,
        cacheControl,
        cacheControlMaxAge: options.cacheControlMaxAge,
      },
    })
  } catch (error) {
    const wrapped = await buildBlobError(error, {
      action: 'upload blob',
      target: targetPath,
      config: getNetlifyConfig(),
    })
    throw wrapped
  }

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

  const store = await getNetlifyStore()
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

  let listResult
  try {
    listResult = await store.list({ prefix, directories: false })
  } catch (error) {
    const wrapped = await buildBlobError(error, {
      action: 'list blobs',
      target: prefix || '(all)',
      config: getNetlifyConfig(),
    })
    throw wrapped
  }
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
      } catch (err) {
        console.warn(`Failed to load metadata for blob ${key}`, err)
        if (err && typeof err === 'object' && (err as any).blobDetails) {
          console.warn('Blob metadata error details', (err as any).blobDetails)
        }
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
  const store = await getNetlifyStore()
  const sanitizedPrefix = normalizePath(prefix)

  if (!store) {
    return deleteFallbackByPrefix(sanitizedPrefix)
  }

  let listResult
  try {
    listResult = await store.list({ prefix: sanitizedPrefix, directories: false })
  } catch (error) {
    const wrapped = await buildBlobError(error, {
      action: 'list blobs for deletion',
      target: sanitizedPrefix || '(all)',
      config: getNetlifyConfig(),
    })
    throw wrapped
  }
  const keys = (listResult?.blobs || [])
    .map((entry) => entry.key)
    .filter((key): key is string => typeof key === 'string' && key.length > 0)

  let removed = 0
  for (const key of keys) {
    try {
      await store.delete(key)
    } catch (error) {
      const wrapped = await buildBlobError(error, {
        action: 'delete blob',
        target: key,
        config: getNetlifyConfig(),
      })
      throw wrapped
    }
    removed += 1
  }

  return removed
}

export async function deleteBlob(pathOrUrl: string): Promise<boolean> {
  if (!pathOrUrl) return false

  const store = await getNetlifyStore()

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

  try {
    await store.delete(targetPath)
  } catch (error) {
    const wrapped = await buildBlobError(error, {
      action: 'delete blob',
      target: targetPath,
      config: getNetlifyConfig(),
    })
    throw wrapped
  }
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

  const store = await getNetlifyStore()
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

  let result
  try {
    result = await store.getWithMetadata(targetPath, { type: 'arrayBuffer' })
  } catch (error) {
    const wrapped = await buildBlobError(error, {
      action: 'read blob',
      target: targetPath,
      config: getNetlifyConfig(),
    })
    throw wrapped
  }
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
    const store = await getNetlifyStore()
    if (!store) {
      return { ok: false, mode: 'netlify', reason: 'failed to initialize store' }
    }
    await store.list({ prefix: '', directories: false })
    return { ok: true, mode: 'netlify', store: config.storeName }
  } catch (error: any) {
    const wrapped = await buildBlobError(error, {
      action: 'validate blob store health',
      config,
    })
    return {
      ok: false,
      mode: 'netlify',
      reason: wrapped.message,
      details: (wrapped as any).blobDetails,
    }
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
    siteSlug: config.siteSlug,
    siteName: config.siteName,
    diagnostics,
  }
}

export { BLOB_PROXY_PREFIX }
export type { BlobEnvDiagnostics, CandidateSummary, BlobErrorDetails }
