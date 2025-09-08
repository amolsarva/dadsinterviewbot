import { list } from '@vercel/blob'
export const config = { runtime:'nodejs' }
export default async function handler(req, res){
  try{
    const page = Number((req.query && req.query.page) || '1')
    const limit = Number((req.query && req.query.limit) || '10')
    const prefix = 'sessions/'
    const { blobs } = await list({ prefix, limit: 2000 })
    const sessions = new Map()
    for (const b of blobs){
      const m = b.pathname.match(/^sessions\/([^/]+)\/(.+)$/); if (!m) continue
      const id = m[1]; const fname = m[2]
      const entry = sessions.get(id) || { sessionId:id, startedAt:null, endedAt:null, totals:{turns:0, durationMs:null}, manifestUrl:null, turns:[] }
      if (/^turn-\d+\.json$/.test(fname)) entry.turns.push({ url: b.url, uploadedAt: b.uploadedAt, name: fname })
      if (/^session-.+\.json$/.test(fname)) entry.manifestUrl = b.url
      sessions.set(id, entry)
    }
    const all = Array.from(sessions.values()).sort((a,b)=> {
      const at = a.turns.length ? a.turns[a.turns.length-1].uploadedAt : 0
      const bt = b.turns.length ? b.turns[b.turns.length-1].uploadedAt : 0
      return new Date(bt) - new Date(at)
    })
    const paged = all.slice((page-1)*limit, page*limit)
    async function enrich(entry){
      entry.turns.sort((a,b)=> a.name.localeCompare(b.name))
      entry.totals.turns = entry.turns.length
      const out = []
      for (const t of entry.turns){
        try{
          const j = await (await fetch(t.url)).json()
          out.push({ turn: j.turn, audio: j.userAudioUrl, manifest: t.url, transcript: j.transcript || '' })
        }catch{}
      }
      entry.allTurns = out
      return entry
    }
    const items = []
    for (const e of paged){ items.push(await enrich(e)) }
    return res.status(200).json({ items })
  }catch(e){
    return res.status(200).json({ items: [] })
  }
}
