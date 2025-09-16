import { put, list } from '@vercel/blob'

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
  if (!process.env.VERCEL_BLOB_READ_WRITE_TOKEN) {
    return { url: `data:${contentType};base64,` + buf.toString('base64') }
  }
  const res = await put(path, buf, {
    access,
    token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
    contentType,
    addRandomSuffix: options.addRandomSuffix,
    cacheControlMaxAge: options.cacheControlMaxAge,
  })
  return { url: res.url, downloadUrl: res.downloadUrl }
}

export async function blobHealth() {
  try {
    if (!process.env.VERCEL_BLOB_READ_WRITE_TOKEN) return { ok: false, reason: 'no token' }
    await list({ token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN })
    return { ok: true }
  } catch (e:any) {
    return { ok: false, reason: e?.message || 'error' }
  }
}
