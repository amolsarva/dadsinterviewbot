import { list } from '@vercel/blob'
export const runtime = 'edge'

// Max number of interviews to fetch details for
const MAX_ITEMS = 10

export default async function handler(req){
  if(req.method!=='GET') return new Response('Method Not Allowed',{status:405})
  try{
    const { blobs } = await list({ prefix:'interviews/', limit:1000 })
    // Only consider .json blobs
    const metaBlobs = blobs.filter(b => (b.pathname||'').endsWith('.json'))
    // Sort by timestamp if available in pathname, else use lastModified
    metaBlobs.sort((a, b) => {
      // Try to extract ISO timestamp from pathname
      const extractTime = b => {
        let ts = b.pathname?.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z)/)?.[0]
        return ts ? Date.parse(ts) : (b.lastModified || 0)
      }
      return extractTime(b) - extractTime(a)
    })

    // Fetch up to MAX_ITEMS blobs in parallel
    const latest = metaBlobs.slice(0, MAX_ITEMS)
    const items = await Promise.all(latest.map(async b => {
      const url = b.downloadUrl || b.url
      if(!url) return null
      try {
        const r = await fetch(url)
        if(!r.ok) return null
        return await r.json()
      } catch {
        return null
      }
    }))
    .then(arr => arr.filter(Boolean))

    return new Response(JSON.stringify({ items }), { status:200, headers: { 'Content-Type': 'application/json' } })
  }catch(err){
    return new Response(JSON.stringify({ items: [], error: err?.message }), { status:200, headers: { 'Content-Type': 'application/json' } })
  }
}