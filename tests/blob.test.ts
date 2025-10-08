import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.NETLIFY_BLOBS_SITE_ID
  delete process.env.NETLIFY_BLOBS_TOKEN
  delete process.env.NETLIFY_BLOBS_STORE
  delete process.env.NETLIFY_BLOBS_CONTEXT
  delete process.env.NETLIFY
  delete process.env.NETLIFY_LOCAL
  delete process.env.NETLIFY_DEV
  delete process.env.NETLIFY_CONTEXT
  delete process.env.DEPLOY_ID
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
    const setContextSpy = vi.fn()
    vi.doMock('@netlify/blobs', () => ({
      getStore: getStoreSpy,
      setEnvironmentContext: setContextSpy,
    }))

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
    expect(setContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        siteID: '12345678-1234-1234-1234-1234567890ab',
        token: 'api-token',
      }),
    )
    expect(result.url).toBe('/api/blob/path/file.txt')
    expect(result.downloadUrl).toBe(result.url)
  })

  it('uses the Netlify runtime token when environment credentials are absent', async () => {
    process.env.NETLIFY = 'true'
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
    const setContextSpy = vi.fn()
    vi.doMock('@netlify/blobs', () => ({
      getStore: getStoreSpy,
      setEnvironmentContext: setContextSpy,
    }))

    const { putBlobFromBuffer } = await import('../lib/blob')
    await putBlobFromBuffer('path/file.txt', Buffer.from('runtime'), 'text/plain')

    expect(getStoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'store-name' }),
    )
    const callArg = getStoreSpy.mock.calls[0][0] as Record<string, unknown>
    expect(callArg).not.toHaveProperty('token')
    expect(callArg).toHaveProperty('siteID', '12345678-1234-1234-1234-1234567890ab')
    expect(setSpy).toHaveBeenCalled()
    expect(setContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        siteID: '12345678-1234-1234-1234-1234567890ab',
      }),
    )
  })

  it('falls back to a data URL when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({
      getStore: vi.fn(),
      setEnvironmentContext: vi.fn(),
    }))
    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')

    expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
    expect(result.downloadUrl).toBe(result.url)
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

  vi.doMock('@netlify/blobs', () => ({
    getStore: getStoreSpy,
    setEnvironmentContext: vi.fn(),
  }))

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

describe('listBlobs', () => {
  it('returns fallback entries when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({
      getStore: vi.fn(),
      setEnvironmentContext: vi.fn(),
    }))
    const { putBlobFromBuffer, listBlobs, clearFallbackBlobs } = await import('../lib/blob')
    clearFallbackBlobs()

    await putBlobFromBuffer('sessions/test/item.json', Buffer.from('{}'), 'application/json')
    const result = await listBlobs({ prefix: 'sessions/test/' })

    expect(result.blobs).toHaveLength(1)
    expect(result.blobs[0].pathname).toBe('sessions/test/item.json')
    expect(result.blobs[0].downloadUrl).toEqual(result.blobs[0].url)
  })
})
