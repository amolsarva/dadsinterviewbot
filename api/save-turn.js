import { saveBlob } from './_blob'
import { getSession, putSession } from './_kv'

export const config = { runtime: 'edge' }

function b64ToUint8(b64){
  const bin = atob(b64 || '')
  const bytes = new Uint8Array(bin.length)
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export default async function handler(req){
  let body = {}
  try { body = await req.json() } catch {}
  const { sessionId, turn, wav, mime='audio/webm', duration_ms=0, reply_text='', transcript='', provider='google', email } = body || {}
  if (!sessionId || !turn) return new Response(JSON.stringify({ ok:false, error:'missing sessionId/turn' }), { status:400, headers:{'Content-Type':'application/json'} })

  const bytes = wav ? b64ToUint8(wav) : new Uint8Array()
  const audioBlob = new Blob([bytes], { type: mime })
  const userAudioUrl = await saveBlob(`sessions/${sessionId}/user-${String(turn).padStart(4,'0')}.webm`, audioBlob, { contentType: mime })

  const turnManifest = {
    sessionId, turn, createdAt: new Date().toISOString(),
    durationMs: duration_ms, userAudioUrl, transcript, assistantReply: reply_text, provider, endIntent:false
  }
  const manifestBlob = new Blob([JSON.stringify(turnManifest,null,2)], { type:'application/json' })
  const manifestUrl = await saveBlob(`sessions/${sessionId}/turn-${String(turn).padStart(4,'0')}.json`, manifestBlob, { contentType:'application/json' })

  const s = (await getSession(sessionId)) || { sessionId, startedAt:new Date().toISOString(), turns:[], totals:{turns:0, durationMs:0} }
  if (email) s.email = email
  s.turns.push({ ts:new Date().toISOString(), turn, audio:userAudioUrl, manifest:manifestUrl })
  s.totals.turns = s.turns.length
  await putSession(s)

  return new Response(JSON.stringify({ ok:true, userAudioUrl, manifestUrl }), { status:200, headers:{'Content-Type':'application/json'} })
}
