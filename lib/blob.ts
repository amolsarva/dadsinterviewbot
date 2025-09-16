import { put, list } from '@vercel/blob'

type PutOptions = {
  access?: 'public' | 'private'
}

export async function putBlobFromBuffer(
  path: string,
  buf: Buffer,
  contentType: string,
  options: PutOptions = {}
) {
  const access = options.access ?? 'private'
  if (!process.env.VERCEL_BLOB_READ_WRITE_TOKEN) {
    return { url: `data:${contentType};base64,` + buf.toString('base64') }
  }
  const res = await put(path, buf, {
    access,
    token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
    contentType,
  })
  return { url: res.url }
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
