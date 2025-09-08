import { put } from '@vercel/blob'
export async function saveBlob(path, data, { contentType } = {}){
  try{
    const res = await put(path, data, { access:'public', contentType })
    return res.url
  }catch(e){
    // Return a recognizable URL so callers can continue even if Blob is misconfigured
    return `blob-error://${encodeURIComponent(path)}`
  }
}
