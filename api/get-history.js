import { listSessions } from './_kv'
export const config = { runtime: 'nodejs' }
export default async function handler(req, res){
  try{
    const url = new URL(req.url, 'http://localhost')
    const page = Number(url.searchParams.get('page')||'1')
    const limit = Number(url.searchParams.get('limit')||'10')
    const items = await listSessions(page, limit)
    return res.status(200).json(items)
  }catch(e){
    return res.status(500).json({ ok:false, error: String(e) })
  }
}
