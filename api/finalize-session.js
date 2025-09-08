import { getSession, putSession } from './_kv.js'
import { saveBlob } from './_blob.js'

export const config = { runtime: 'nodejs' }

async function sendSummaryEmail(to, subject, html){
  const key = process.env.SENDGRID_API_KEY
  const from = process.env.MAIL_FROM || 'bot@example.com'
  if (!key || !to) return { skipped:true }
  try{
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from }, subject, content: [{ type:'text/html', value: html }]
      })
    })
    return { ok:r.ok, status:r.status }
  }catch(e){ return { ok:false, error:String(e) } }
}

export default async function handler(req, res){
  try{
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')
    const { sessionId } = body || {}
    let s = await getSession(sessionId)
    if (!s){
      // Tolerate missing KV; produce a minimal manifest so UI doesn't hang
      s = { sessionId, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), turns: [], totals:{ turns:0, durationMs:0 } }
      try{ await putSession(s) }catch{}
    } else {
      s.endedAt = new Date().toISOString()
      s.totals = s.totals || { turns: s.turns?.length || 0, durationMs: 0 }
    }

    const manifest = { sessionId:s.sessionId, email:s.email||null, startedAt:s.startedAt, endedAt:s.endedAt, turns:s.turns||[], totals:s.totals }
    const manifestUrl = await saveBlob(`sessions/${sessionId}/session-${sessionId}.json`, Buffer.from(JSON.stringify(manifest,null,2)), { contentType:'application/json' })
    s.manifestUrl = manifestUrl
    try{ await putSession(s) }catch{}

    if (s.email){
      const rows = (s.turns||[]).map(t=>`<tr><td style="padding:6px 8px;border:1px solid #eee;">${t.turn}</td><td style="padding:6px 8px;border:1px solid #eee;"><a href="${t.audio}">Audio</a></td><td style="padding:6px 8px;border:1px solid #eee;"><a href="${t.manifest}">Manifest</a></td></tr>`).join('')
      const html = `<p>Here are your session links.</p>
        <p><b>Total turns:</b> ${s.totals?.turns||0}</p>
        <p><a href="${manifestUrl}">Session manifest JSON</a></p>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #eee;">
          <tr><th style="padding:6px 8px;border:1px solid #eee;">Turn</th><th style="padding:6px 8px;border:1px solid #eee;">Audio</th><th style="padding:6px 8px;border:1px solid #eee;">Manifest</th></tr>
          ${rows}
        </table>`
      await sendSummaryEmail(s.email, "Dad’s Interview Bot — Session Summary", html)
    }

    return res.status(200).json({ ok:true, manifestUrl: s.manifestUrl, totalTurns:s.totals?.turns||0, totalDurationMs:s.totals?.durationMs||0 })
  }catch(e){
    // Never 500—surface the error and still respond
    return res.status(200).json({ ok:false, error:String(e) })
  }
}
