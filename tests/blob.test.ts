import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_SECRET_KEY
  delete process.env.SUPABASE_ANON_KEY
  delete process.env.SUPABASE_STORAGE_BUCKET
  delete process.env.SUPABASE_BUCKET
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('putBlobFromBuffer', () => {
  it('uploads via Supabase when credentials are provided', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    process.env.SUPABASE_STORAGE_BUCKET = 'test-bucket'

    const uploadSpy = vi.fn(async () => ({ data: { path: 'path/file.txt' }, error: null }))
    const getPublicUrlSpy = vi.fn(() => ({ data: { publicUrl: '' } }))
    const createSignedUrlSpy = vi.fn(async () => ({ data: { signedUrl: '' }, error: null }))
    const removeSpy = vi.fn(async () => ({ error: null }))
    const fromSpy = vi.fn(() => ({
      upload: uploadSpy,
      getPublicUrl: getPublicUrlSpy,
      createSignedUrl: createSignedUrlSpy,
      remove: removeSpy,
    }))
    const createClientSpy = vi.fn(() => ({ storage: { from: fromSpy } }))

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: createClientSpy,
    }))

    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

    expect(createClientSpy).toHaveBeenCalled()
    expect(fromSpy).toHaveBeenCalledWith('test-bucket')
    expect(uploadSpy).toHaveBeenCalledWith(
      'path/file.txt',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'text/plain', upsert: true }),
    )
    expect(result.url).toBe('/api/blob/path/file.txt')
    expect(result.downloadUrl).toBe('/api/blob/path/file.txt')
  })

  it('falls back to a data URL when storage is not configured', async () => {
    vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')

    expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
    expect(result.downloadUrl).toBe(result.url)
  })
})

describe('listBlobs', () => {
  it('returns fallback entries when storage is not configured', async () => {
    vi.doMock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
    const { putBlobFromBuffer, listBlobs, clearFallbackBlobs } = await import('../lib/blob')
    clearFallbackBlobs()

    await putBlobFromBuffer('sessions/test/item.json', Buffer.from('{}'), 'application/json')
    const result = await listBlobs({ prefix: 'sessions/test/' })

    expect(result.blobs).toHaveLength(1)
    expect(result.blobs[0].pathname).toBe('sessions/test/item.json')
    expect(result.blobs[0].downloadUrl).toEqual(result.blobs[0].url)
  })
})
