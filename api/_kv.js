const KV_URL = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN

async function kvGet(key){
  if (!KV_URL || !KV_TOKEN) return null
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  })
  if (!r.ok) return null
  const j = await r.json()
  return j.result ? JSON.parse(j.result) : null
}
async function kvSet(key, value){
  if (!KV_URL || !KV_TOKEN) return
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${KV_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ value: JSON.stringify(value) })
  })
}
async function kvZAdd(key, score, member){
  if (!KV_URL || !KV_TOKEN) return
  await fetch(`${KV_URL}/zadd/${encodeURIComponent(key)}`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${KV_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ score, member })
  })
}
async function kvZRange(key, start, stop, {rev=false}={}){
  if (!KV_URL || !KV_TOKEN) return []
  const r = await fetch(`${KV_URL}/zrange/${encodeURIComponent(key)}/${start}/${stop}${rev?'/rev':''}`, {
    headers:{ Authorization:`Bearer ${KV_TOKEN}` }
  })
  if (!r.ok) return []
  const j = await r.json()
  return j.result || []
}

export async function getSession(id){ return kvGet(`session:${id}`) }
export async function putSession(obj){ await kvSet(`session:${obj.sessionId}`, obj); await kvZAdd('sessions:index', Date.now(), obj.sessionId) }
export async function appendTurn(id, meta){
  const s = (await getSession(id)) || { sessionId:id, startedAt:new Date().toISOString(), turns:[], totals:{turns:0, durationMs:0} }
  s.turns.push(meta); s.totals.turns = s.turns.length
  await putSession(s); return s
}
export async function listSessions(page=1, limit=10){
  const total = page*limit
  const ids = await kvZRange('sessions:index', 0, total, {rev:true})
  const slice = ids.slice((page-1)*limit, page*limit)
  const items = []
  for (const id of slice){
    const s = await getSession(id)
    if (s) items.push({ sessionId:s.sessionId, startedAt:s.startedAt, endedAt:s.endedAt, totals:s.totals, manifestUrl:s.manifestUrl })
  }
  return { items }
}
