import { put } from '@vercel/blob'
function toDataURL(bytes, contentType='application/octet-stream'){ try{ const b64 = Buffer.from(bytes).toString('base64'); return `data:${contentType};base64,${b64}` }catch{ return `data:${contentType};base64,` } }
export async function saveBlob(path, data, { contentType } = {}){
  try{
    if (process.env.BLOB_READ_WRITE_TOKEN){
      const res = await put(path, data, { access:'public', contentType }); if (res && res.url) return res.url
    }
    return toDataURL(data, contentType || 'application/octet-stream')
  }catch{ return toDataURL(data, contentType || 'application/octet-stream') }
}
