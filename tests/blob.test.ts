import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.VERCEL_BLOB_READ_WRITE_TOKEN
  delete process.env.BLOB_READ_WRITE_TOKEN
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('putBlobFromBuffer', () => {
  it('uses public access when uploading with a token', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
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

  it('falls back to a data URL when no token is available', async () => {
    vi.doMock('@vercel/blob', () => ({
      put: vi.fn(),
      list: vi.fn(),
    }))
    const { putBlobFromBuffer } = await import('../lib/blob')
    const result = await putBlobFromBuffer('path/file.txt', Buffer.from('hi'), 'text/plain')

    expect(result.url.startsWith('data:text/plain;base64,')).toBe(true)
  })
})
