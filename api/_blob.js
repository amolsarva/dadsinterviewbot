import { put } from '@vercel/blob'
function toDataURL(bytes, contentType='application/octet-stream'){ try{ const b64 = Buffer.from(bytes).toString('base64'); return `data:${contentType};base64,${b64}` }catch{ return `data:${contentType};base64,` } }
export async function saveBlob(path, data, { contentType } = {}){
  try{
    const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_READ_WRITE_TOKEN
    if (token){
      const res = await put(path, data, { access:'public', contentType, token }); if (res && res.url) return res.url
    }
    return toDataURL(data, contentType || 'application/octet-stream')
  }catch{ return toDataURL(data, contentType || 'application/octet-stream') }
}
