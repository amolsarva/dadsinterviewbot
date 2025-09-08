import { listSessions } from './_kv'
export const config = { runtime: 'nodejs' }
export default async function handler(req, res){
  try{
    const page = Number((req.query && req.query.page) || '1')
    const limit = Number((req.query && req.query.limit) || '10')
    const items = await listSessions(page, limit)
    return res.status(200).json(items || { items: [] })
  }catch(e){
    return res.status(200).json({ items: [] })
  }
}
