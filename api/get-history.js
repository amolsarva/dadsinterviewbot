import { list } from '@vercel/blob'
export const runtime = 'edge'

export default async function handler(req){
  if(req.method!=='GET') return new Response('Method Not Allowed',{status:405})
  try{
    const { blobs } = await list({ prefix:'interviews/', limit:1000 })
    const items = []
    for(const b of blobs){
      if(!(b.pathname||'').endsWith('.json')) continue
      const url = b.downloadUrl || b.url
      if(!url) continue
      const r = await fetch(url)
      if(!r.ok) continue
      const meta = await r.json().catch(()=>null)
      if(meta) items.push(meta)
    }
    items.sort((a,b)=> new Date(b.timestamp||0) - new Date(a.timestamp||0))
    return new Response(JSON.stringify({ items }), { status:200, headers: { 'Content-Type': 'application/json' } })
  }catch{
    return new Response(JSON.stringify({ items: [] }), { status:200, headers: { 'Content-Type': 'application/json' } })
  }
}
