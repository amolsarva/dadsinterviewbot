import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.NETLIFY_BLOBS_SITE_ID
  delete process.env.NETLIFY_BLOBS_TOKEN
  delete process.env.NETLIFY_BLOBS_STORE
  delete process.env.NETLIFY_BLOBS_CONTEXT
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('putBlobFromBuffer', () => {
  it('uploads via Netlify when credentials are provided', async () => {
    process.env.NETLIFY_BLOBS_SITE_ID = 'site-id'
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
      siteID: 'site-id',
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

  it('falls back to a data URL when storage is not configured', async () => {
    vi.doMock('@netlify/blobs', () => ({ getStore: vi.fn() }))
    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')

    expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
    expect(result.downloadUrl).toBe(result.url)
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
