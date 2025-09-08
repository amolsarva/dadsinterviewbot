import { saveBlob } from './_blob.js'

export const config = { runtime:'nodejs' }

async function sendSummaryEmail(to, subject, html){
  const key=process.env.SENDGRID_API_KEY, from=process.env.MAIL_FROM||'bot@example.com'
  if(!key||!to) return {skipped:true}
  try{ const r=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({personalizations:[{to:[{email:to}]}],from:{email:from},subject,content:[{type:'text/html',value:html}]})}); return {ok:r.ok,status:r.status} }catch(e){ return {ok:false,error:String(e)} }
}

export default async function handler(req,res){
  try{
    const body = typeof req.body==='object'?req.body:JSON.parse(req.body||'{}')
    const { sessionId, email } = body||{}
    // The client has been saving per-turn manifests already. We only aggregate references.
    // Since we no longer have KV, we cannot compute totals unless the client sends them;
    // we still build a session manifest container for convenience.
    const manifest = {
      sessionId, email: email || null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      // Minimal set; turn manifests are already saved alongside audio
      turns: [], totals: { turns: null, durationMs: null }
    }
    const manifestUrl = await saveBlob(`sessions/${sessionId}/session-${sessionId}.json`, Buffer.from(JSON.stringify(manifest,null,2)), { contentType:'application/json' })

    if (email){
      const html = `<p>Your session is finalized.</p><p><a href="${manifestUrl}">Session manifest JSON</a></p>`
      await sendSummaryEmail(email, "Dad’s Interview Bot — Session Summary", html)
    }
    return res.status(200).json({ ok:true, manifestUrl, totalTurns:null, totalDurationMs:null })
  }catch(e){
    return res.status(200).json({ ok:false, error:String(e) })
  }
}
