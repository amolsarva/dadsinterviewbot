import { saveBlob } from './_blob.js'
export const config = { runtime:'nodejs' }
export default async function handler(req,res){
  try{
    const body = typeof req.body==='object'?req.body:JSON.parse(req.body||'{}')
    const { sessionId, turn, wav, mime='audio/webm', duration_ms=0, reply_text='', transcript='', provider='google' } = body||{}
    if(!sessionId||!turn) return res.status(400).json({ ok:false, error:'missing sessionId/turn' })
    const wavBytes = Buffer.from(wav||'', 'base64')
    const userAudioUrl = await saveBlob(`sessions/${sessionId}/user-${String(turn).padStart(4,'0')}.webm`, wavBytes, { contentType: mime })
    const turnManifest = { sessionId, turn, createdAt:new Date().toISOString(), durationMs:duration_ms, userAudioUrl, transcript, assistantReply:reply_text, provider, endIntent:false }
    const manifestUrl = await saveBlob(`sessions/${sessionId}/turn-${String(turn).padStart(4,'0')}.json`, Buffer.from(JSON.stringify(turnManifest,null,2)), { contentType:'application/json' })
    return res.status(200).json({ ok:true, userAudioUrl, manifestUrl })
  }catch(e){ return res.status(200).json({ ok:false, error:String(e) }) }
}
