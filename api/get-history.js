import { list } from '@vercel/blob'

export const config = { runtime:'nodejs' }

export default async function handler(req, res){
  try{
    const page = Number((req.query && req.query.page) || '1')
    const limit = Number((req.query && req.query.limit) || '10')
    const prefix = 'sessions/'
    const { blobs } = await list({ prefix, limit: 1000 }) // fetch all and paginate in code
    // pick only session manifests: sessions/<id>/session-<id>.json
    const sessions = blobs
      .filter(b => /sessions\/.+\/session-.+\.json$/.test(b.pathname))
      .sort((a,b)=> new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())

    const slice = sessions.slice((page-1)*limit, page*limit)
    const items = slice.map(b => {
      const m = b.pathname.match(/sessions\/(.+)\/session-\1\.json/)
      const id = m ? m[1] : 'unknown'
      return { sessionId: id, startedAt: null, endedAt: null, totals: { turns: null, durationMs: null }, manifestUrl: b.url }
    })
    return res.status(200).json({ items })
  }catch(e){
    return res.status(200).json({ items: [] })
  }
}
