import { listSessions } from './_kv'
export const config = { runtime: 'edge' }
export default async function handler(req){
  const url = new URL(req.url)
  const page = Number(url.searchParams.get('page')||'1')
  const limit = Number(url.searchParams.get('limit')||'10')
  const items = await listSessions(page, limit)
  return new Response(JSON.stringify(items), { status:200, headers:{'Content-Type':'application/json'} })
}
