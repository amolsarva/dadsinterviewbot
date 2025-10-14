import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.NETLIFY_BLOBS_SITE_ID
  delete process.env.NETLIFY_BLOBS_TOKEN
  delete process.env.NETLIFY_BLOBS_STORE
  delete process.env.NETLIFY_BLOBS_CONTEXT
  delete process.env.FORCE_PROD_BLOBS
  delete process.env.CONTEXT
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
    await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

    expect(getStoreSpy).toHaveBeenCalled()
    const call = getStoreSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).toMatchObject({ name: 'store-name', siteID: '12345678-1234-1234-1234-1234567890ab' })
    expect('token' in call).toBe(false)
    expect(setSpy).toHaveBeenCalled()
  })

  it('throws when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))
    const { putBlobFromBuffer } = await import('../lib/blob')
    await expect(putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')).rejects.toThrow(
      /Netlify blob storage credentials are missing/i,
    )
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

it('throws when given a site slug without a token to resolve it', async () => {
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
  await expect(putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')).rejects.toThrow(
    /Netlify API token/i,
  )
})

describe('listBlobs', () => {
  it('propagates errors when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))
    const { putBlobFromBuffer, listBlobs } = await import('../lib/blob')

    await expect(
      putBlobFromBuffer('sessions/test/item.json', Buffer.from('{}'), 'application/json'),
    ).rejects.toThrow()
    await expect(listBlobs({ prefix: 'sessions/test/' })).rejects.toThrow()
  })
})

it('requires NETLIFY_BLOBS_SITE_ID when FORCE_PROD_BLOBS is set in preview contexts', async () => {
  process.env.FORCE_PROD_BLOBS = 'true'
  process.env.CONTEXT = 'deploy-preview'
  vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))

  const { putBlobFromBuffer } = await import('../lib/blob')
  await expect(putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')).rejects.toThrow(
    /FORCE_PROD_BLOBS is enabled/i,
  )
})
