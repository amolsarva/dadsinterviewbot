import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.VERCEL_BLOB_READ_WRITE_TOKEN
  delete process.env.BLOB_PUBLIC_BASE_URL
  const globalAny = globalThis as any
  if (globalAny.__dads_interview_blob_fallback__) {
    const store = globalAny.__dads_interview_blob_fallback__
    if (store && typeof store.clear === 'function') {
      store.clear()
    }
  }
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('putBlobFromBuffer', () => {
  it('uses public access when uploading with a token', async () => {
    process.env.VERCEL_BLOB_READ_WRITE_TOKEN = 'test-token'
    const putSpy = vi.fn(async () => ({
      url: 'https://blob.test/resource',
      downloadUrl: 'https://blob.test/resource?download=1',
    }))
    vi.doMock('@vercel/blob', () => ({
      put: putSpy,
      list: vi.fn(),
    }))
    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hello'), 'text/plain')

    expect(putSpy).toHaveBeenCalledWith(
      'path/file.txt',
      expect.any(Buffer),
      expect.objectContaining({ access: 'public', token: 'test-token', contentType: 'text/plain' })
    )
    expect(result).toEqual({
      url: 'https://blob.test/resource',
      downloadUrl: 'https://blob.test/resource?download=1',
    })
  })

  it('falls back to the internal blob route when no token is available', async () => {
    vi.doMock('@vercel/blob', () => ({
      put: vi.fn(),
      list: vi.fn(),
    }))
    const { putBlobFromBuffer, listBlobs } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')

    expect(result.url).toMatch(/^data:text\/plain/)
    expect(result.downloadUrl).toBe(result.url)

    const listed = await listBlobs({ prefix: 'path/' })
    expect(listed.blobs).toHaveLength(1)
    expect(listed.blobs[0]).toMatchObject({
      pathname: 'path/file.txt',
    })
    expect(listed.blobs[0]!.url).toMatch(/^data:text\/plain/)
    expect(listed.blobs[0]!.downloadUrl).toBe(listed.blobs[0]!.url)
  })
})
