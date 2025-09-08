import { saveBlob } from './_blob'
import { getSession, putSession } from './_kv'
export const config = { runtime: 'edge' }

export default async function handler(req){
  const body = await req.json().catch(()=>null)
  if (!body) return new Response('Bad Request', {status:400})
  const { sessionId, turn, wav, mime='audio/webm', duration_ms=0, reply_text='', transcript='', provider='google', email } = body
  const wavBytes = Buffer.from(wav||'', 'base64')
  const audioPath = `sessions/${sessionId}/user-${String(turn).padStart(4,'0')}.webm`
  const userAudioUrl = await saveBlob(audioPath, wavBytes, { contentType: mime })

  const turnManifest = {
    sessionId, turn, createdAt: new Date().toISOString(),
    durationMs: duration_ms, userAudioUrl, transcript, assistantReply: reply_text, provider, endIntent:false
  }
  const manPath = `sessions/${sessionId}/turn-${String(turn).padStart(4,'0')}.json`
  const manifestUrl = await saveBlob(manPath, Buffer.from(JSON.stringify(turnManifest,null,2)), { contentType:'application/json' })

  const s = (await getSession(sessionId)) || { sessionId, startedAt:new Date().toISOString(), turns:[], totals:{turns:0, durationMs:0} }
  if (email) s.email = email
  s.turns.push({ ts:new Date().toISOString(), turn, audio:userAudioUrl, manifest:manifestUrl })
  s.totals.turns = s.turns.length
  await putSession(s)

  return new Response(JSON.stringify({ ok:true, userAudioUrl, manifestUrl }), { status:200, headers:{'Content-Type':'application/json'} })
}
