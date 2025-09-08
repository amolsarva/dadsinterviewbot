import { put } from '@vercel/blob'
export async function saveBlob(path, data, { contentType } = {}){
  const res = await put(path, data, { access:'public', contentType })
  return res.url
}
