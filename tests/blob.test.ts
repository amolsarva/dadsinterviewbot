import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.NETLIFY_BLOBS_SITE_ID
  delete process.env.NETLIFY_BLOBS_TOKEN
  delete process.env.NETLIFY_BLOBS_STORE
  delete process.env.NETLIFY_BLOBS_CONTEXT
  delete process.env.NETLIFY_BLOBS_API_URL
  delete process.env.NETLIFY_API_TOKEN
  delete process.env.BLOBS_TOKEN
  delete process.env.STRICT_BLOBS
  delete process.env.STRICT_STORAGE
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('putBlobFromBuffer', () => {
  it('uploads via Netlify when credentials are provided', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_TOKEN = 'api-token'
    process.env.NETLIFY_BLOBS_STORE = 'store-name'

    const setSpy = vi.fn(async () => ({}))
    const storeMock = {
      set: setSpy,
      list: vi.fn(async () => ({ blobs: [] })),
      getMetadata: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      getWithMetadata: vi.fn(async () => null),
    }

    const getStoreSpy = vi.fn(() => storeMock)
    vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

    expect(getStoreSpy).toHaveBeenCalledWith({
      name: 'store-name',
      siteID: '12345678-1234-1234-1234-1234567890ab',
      token: 'api-token',
      apiURL: undefined,
      edgeURL: undefined,
      uncachedEdgeURL: undefined,
      consistency: undefined,
    })
    expect(setSpy).toHaveBeenCalled()
    expect(result.url).toBe('/api/blob/path/file.txt')
    expect(result.downloadUrl).toBe(result.url)
    expect(result.via).toBe('netlify-sdk')
    expect(result.store).toBe('store-name')
    expect(result.siteId).toBeDefined()
    expect(result.siteId).toContain('…')
  })

  it('uploads via Netlify without a token when the site ID is canonical', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_STORE = 'store-name'

    const setSpy = vi.fn(async () => ({}))
    const storeMock = {
      set: setSpy,
      list: vi.fn(async () => ({ blobs: [] })),
      getMetadata: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      getWithMetadata: vi.fn(async () => null),
    }

    const getStoreSpy = vi.fn(() => storeMock)
    vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

    expect(getStoreSpy).toHaveBeenCalled()
    const firstCall = getStoreSpy.mock.calls.at(0)
    const callArgs = Array.isArray(firstCall) ? (firstCall as unknown[]) : []
    const configArg = callArgs[0] ?? null
    const call = (configArg && typeof configArg === 'object' ? configArg : {}) as Record<string, unknown>
    expect(call).toMatchObject({ name: 'store-name', siteID: '12345678-1234-1234-1234-1234567890ab' })
    expect('token' in call).toBe(false)
    expect(setSpy).toHaveBeenCalled()
    expect(result.via).toBe('netlify-sdk')
    expect(result.store).toBe('store-name')
    expect(result.siteId).toContain('…')
  })

  it('falls back to a data URL when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))
    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')

    expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
    expect(result.downloadUrl).toBe(result.url)
    expect(result.via).toBe('memory')
    expect(result.store).toBe('memory')
    expect(result.siteId).toBeUndefined()
  })
})

it('resolves a site slug to the canonical Netlify site ID', async () => {
  process.env.NETLIFY_BLOBS_SITE_ID = 'dadsbot'
  process.env.NETLIFY_BLOBS_TOKEN = 'api-token'

  const setSpy = vi.fn(async () => ({}))
  const storeMock = {
    set: setSpy,
    list: vi.fn(async () => ({ blobs: [] })),
    getMetadata: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    getWithMetadata: vi.fn(async () => null),
  }

  const getStoreSpy = vi.fn(() => storeMock)
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: '98765432-4321-4321-4321-ba0987654321', name: 'dadsbot-site' }),
  }))
  vi.stubGlobal('fetch', fetchSpy)

  vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

  const { putBlobFromBuffer } = await import('../lib/blob')
  await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

  expect(fetchSpy).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/sites/dadsbot'),
    expect.objectContaining({ method: 'GET' }),
  )

  expect(getStoreSpy).toHaveBeenCalledWith(
    expect.objectContaining({ siteID: '98765432-4321-4321-4321-ba0987654321' }),
  )
})

it('falls back to memory when given a site slug without a token to resolve it', async () => {
  process.env.NETLIFY_BLOBS_SITE_ID = 'dadsbot'

  const setSpy = vi.fn(async () => ({}))
  const storeMock = {
    set: setSpy,
    list: vi.fn(async () => ({ blobs: [] })),
    getMetadata: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    getWithMetadata: vi.fn(async () => null),
  }

  const getStoreSpy = vi.fn(() => storeMock)
  vi.doMock('@netlify/blobs', () => ({ getStore: getStoreSpy }))

  const { putBlobFromBuffer } = await import('../lib/blob')
  const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

  expect(getStoreSpy).not.toHaveBeenCalled()
  expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
  expect(result.downloadUrl).toBe(result.url)
  expect(result.via).toBe('memory')
  expect(result.store).toBe('memory')
  expect(result.siteId).toBe('dadsbot')
})

it('throws a strict blob error when STRICT_BLOBS forbids memory fallback', async () => {
  process.env.STRICT_BLOBS = '1'
  vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))

  const { putBlobFromBuffer } = await import('../lib/blob')

  expect.assertions(4)
  try {
    await putBlobFromBuffer('path/file.txt', Buffer.from('strict'), 'text/plain')
  } catch (error: any) {
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('Failed to initialize blob store')
    expect(error).toHaveProperty('blobDetails')
    expect((error as any).blobDetails).toMatchObject({
      action: 'initialize blob store',
      strictMode: true,
    })
    return
  }
  throw new Error('Expected strict mode blob error')
})

describe('/api/diagnostics/storage', () => {
  it('surfaces strict-mode Netlify initialization failures with masked identifiers', async () => {
    process.env.STRICT_BLOBS = '1'
    process.env.NETLIFY_BLOBS_SITE_ID = '12345678-1234-1234-1234-1234567890ab'
    process.env.NETLIFY_BLOBS_STORE = 'wrong-store'

    const diagnostics = {
      usingContext: false,
      contextKeys: [],
      missing: [],
      store: { present: true, defaulted: false, selected: { key: 'env:store', source: 'env', present: true, valuePreview: 'wrong-store' }, candidates: [] },
      siteId: { present: true, selected: { key: 'env:siteId', source: 'env', present: true, valuePreview: '1234…90ab' }, candidates: [] },
      token: { present: true, length: 10, selected: { key: 'context:token', source: 'context', present: true, valuePreview: '10 chars' }, candidates: [] },
      optional: {
        apiUrl: { present: false, selected: undefined, candidates: [] },
        edgeUrl: { present: false, selected: undefined, candidates: [] },
        uncachedEdgeUrl: { present: false, selected: undefined, candidates: [] },
      },
    }

    const envError = {
      message: 'Failed to initialize Netlify blob store "wrong-store" (site 1234…90ab)',
      originalMessage: 'Failed to initialize Netlify blob store "wrong-store" (site 1234…90ab)',
      store: 'wrong-store',
      siteIdMasked: '1234…90ab',
      requestId: 'req-123',
      status: 401,
    }

    const env = {
      provider: 'netlify',
      configured: false,
      store: 'wrong-store',
      siteId: '1234…90ab',
      diagnostics,
      error: envError,
      strictMode: true,
    }

    const blobHealthMock = vi.fn(async () => ({ ok: false, mode: 'netlify', reason: 'init failed', details: envError }))
    const getBlobEnvironmentMock = vi.fn(() => env)
    const primeMock = vi.fn()
    const putBlobMock = vi.fn(async () => {
      throw new Error('unexpected upload')
    })
    const readBlobMock = vi.fn(async () => null)

    vi.doMock('@/lib/blob', () => ({
      BLOB_PROXY_PREFIX: '/api/blob/',
      blobHealth: blobHealthMock,
      getBlobEnvironment: getBlobEnvironmentMock,
      primeNetlifyBlobContextFromHeaders: primeMock,
      putBlobFromBuffer: putBlobMock,
      readBlob: readBlobMock,
    }))
    vi.doMock('node:crypto', () => ({ randomUUID: () => 'probe-123' }))

    const { GET } = await import('../app/api/diagnostics/storage/route')
    const request: any = {
      headers: new Headers(),
      nextUrl: new URL('https://example.com/api/diagnostics/storage'),
    }

    const response = await GET(request)
    const payload = await response.json()

    expect(payload.ok).toBe(false)
    expect(payload.env.strictMode).toBe(true)
    expect(payload.message).toContain('wrong-store')
    expect(payload.message).toContain('1234…90ab')
    expect(Array.isArray(payload.flow.steps)).toBe(true)
    const initStep = payload.flow.steps.find((step: any) => step.id === 'netlify_init')
    expect(initStep).toBeDefined()
    expect(initStep.ok).toBe(false)
    expect(initStep.details).toMatchObject({ store: 'wrong-store', siteIdMasked: '1234…90ab', requestId: 'req-123' })
    expect(putBlobMock).not.toHaveBeenCalled()
  })

  it('records memory fallback behaviour when diagnostics run outside strict mode', async () => {
    const diagnostics = {
      usingContext: false,
      contextKeys: [],
      missing: [],
      store: { present: true, defaulted: false, selected: { key: 'env:store', source: 'env', present: true, valuePreview: 'dads-interview-bot' }, candidates: [] },
      siteId: { present: true, selected: { key: 'env:siteId', source: 'env', present: true, valuePreview: '1234…90ab' }, candidates: [] },
      token: { present: false, length: 0, selected: undefined, candidates: [] },
      optional: {
        apiUrl: { present: false, selected: undefined, candidates: [] },
        edgeUrl: { present: false, selected: undefined, candidates: [] },
        uncachedEdgeUrl: { present: false, selected: undefined, candidates: [] },
      },
    }

    const env = {
      provider: 'netlify',
      configured: true,
      store: 'dads-interview-bot',
      siteId: '1234…90ab',
      diagnostics,
      error: null,
      strictMode: false,
    }

    const blobHealthMock = vi.fn(async () => ({ ok: true, mode: 'netlify', store: 'dads-interview-bot' }))
    const getBlobEnvironmentMock = vi.fn(() => env)
    const primeMock = vi.fn()
    const putBlobMock = vi.fn(async (path: string) => ({
      url: `/api/blob/${path}`,
      downloadUrl: `/api/blob/${path}`,
      via: 'memory',
      store: 'memory',
      siteId: '1234…90ab',
    }))
    const readBlobMock = vi.fn(async () => ({
      buffer: Buffer.from('{}', 'utf8'),
      contentType: 'application/json',
      size: 2,
    }))

    const fetchMock = vi.fn(async (_input: any, init?: any) => {
      const method = (init?.method || 'GET').toString().toUpperCase()
      const seq = fetchMock.mock.calls.length + 1
      const headers = new Headers({
        'content-type': 'application/json',
        'x-request-id': `${method.toLowerCase()}-${seq}`,
      })
      const body = JSON.stringify({ ok: true, via: 'memory', method })
      return new Response(body, { status: 200, headers })
    })

    vi.stubGlobal('fetch', fetchMock as any)
    vi.doMock('@/lib/blob', () => ({
      BLOB_PROXY_PREFIX: '/api/blob/',
      blobHealth: blobHealthMock,
      getBlobEnvironment: getBlobEnvironmentMock,
      primeNetlifyBlobContextFromHeaders: primeMock,
      putBlobFromBuffer: putBlobMock,
      readBlob: readBlobMock,
    }))
    vi.doMock('node:crypto', () => ({ randomUUID: () => 'probe-789' }))

    const { GET } = await import('../app/api/diagnostics/storage/route')
    const request: any = {
      headers: new Headers(),
      nextUrl: new URL('https://example.com/api/diagnostics/storage'),
    }

    const response = await GET(request)
    const payload = await response.json()

    expect(payload.ok).toBe(true)
    expect(payload.env.strictMode).toBe(false)
    expect(payload.message).toContain('Netlify blob store "dads-interview-bot"')
    const sdkStep = payload.flow.steps.find((step: any) => step.id === 'sdk_write')
    expect(sdkStep).toBeDefined()
    expect(sdkStep.note).toContain('memory')
    const proxyPut = payload.flow.steps.find((step: any) => step.id === 'proxy_put')
    expect(proxyPut).toBeDefined()
    expect(proxyPut.ok).toBe(true)
    expect(proxyPut.responseSnippet).toContain('memory')
    expect(proxyPut.requestId).toMatch(/put/i)
    const proxyGet = payload.flow.steps.find((step: any) => step.id === 'proxy_get')
    expect(proxyGet).toBeDefined()
    expect(proxyGet.responseSnippet).toContain('memory')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('listBlobs', () => {
  it('returns fallback entries when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))
    const { putBlobFromBuffer, listBlobs, clearFallbackBlobs } = await import('../lib/blob')
    clearFallbackBlobs()

    await putBlobFromBuffer('sessions/test/item.json', Buffer.from('{}'), 'application/json')
    const result = await listBlobs({ prefix: 'sessions/test/' })

    expect(result.blobs).toHaveLength(1)
    expect(result.blobs[0].pathname).toBe('sessions/test/item.json')
    expect(result.blobs[0].downloadUrl).toEqual(result.blobs[0].url)
  })
})
