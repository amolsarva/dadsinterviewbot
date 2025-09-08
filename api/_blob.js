import { put } from '@vercel/blob'
export async function saveBlob(path, data, {contentType}={}){
  return (await put(path, data, { access:'public', contentType })).url
}
