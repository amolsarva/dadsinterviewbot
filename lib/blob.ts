import { put, list } from '@vercel/blob'

export function getBlobToken() {
  return process.env.VERCEL_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN
}

export async function putBlobFromBuffer(
  path: string,
  buf: Buffer,
  contentType: string,
  options: {
    access?: 'public'
    addRandomSuffix?: boolean
    cacheControlMaxAge?: number
  } = {}
) {
  const access = options.access ?? 'public'
  const token = getBlobToken()
  if (!token) {
    return { url: `data:${contentType};base64,` + buf.toString('base64') }
  }
  const res = await put(path, buf, {
    access,
    token,
    contentType,
    addRandomSuffix: options.addRandomSuffix,
    cacheControlMaxAge: options.cacheControlMaxAge,
  })
  return { url: res.url, downloadUrl: res.downloadUrl }
}

export async function blobHealth() {
  try {
    const token = getBlobToken()
    if (!token) return { ok: false, reason: 'no token' }
    await list({ token })
    return { ok: true }
  } catch (e:any) {
    return { ok: false, reason: e?.message || 'error' }
  }
}
