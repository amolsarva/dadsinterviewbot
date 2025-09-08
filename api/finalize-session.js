import { list, get } from '@vercel/blob'
import { saveBlob } from './_blob.js'

export const config = { runtime:'nodejs' }

async function sendSummaryEmail(to, subject, html){
  const key=process.env.SENDGRID_API_KEY, from=process.env.MAIL_FROM||'bot@example.com'
  if(!key||!to) return {skipped:true}
  try{
    const r=await fetch('https://api.sendgrid.com/v3/mail/send',{
      method:'POST',
      headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
      body: JSON.stringify({ personalizations:[{ to:[{email:to}] }], from:{email:from}, subject, content:[{type:'text/html', value:html}] })
    })
    return { ok:r.ok, status:r.status }
  }catch(e){ return { ok:false, error:String(e) } }
}

export default async function handler(req,res){
  try{
    const body = typeof req.body==='object'?req.body:JSON.parse(req.body||'{}')
    const { sessionId, email } = body||{}
    if(!sessionId) return res.status(400).json({ ok:false, error:'missing sessionId' })

    // Gather all turn manifests for this session from Blob
    const prefix = `sessions/${sessionId}/`
    const { blobs } = await list({ prefix, limit: 1000 })
    const turnJsons = blobs.filter(b => /turn-\d+\.json$/.test(b.pathname)).sort((a,b)=> a.pathname.localeCompare(b.pathname))
    const turns = []
    for (const b of turnJsons){
      try{
        const j = await (await fetch(b.url)).json()
        turns.push({ turn:j.turn, audio:j.userAudioUrl, manifest:b.url, transcript:(j.transcript||'')[:120] if false else (j.transcript||'') })
      }catch{}
    }
    // Compute totals
    const totals = { turns: turns.length, durationMs: null }
    const manifest = { sessionId, email: email||null, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), turns, totals }
    const manifestUrl = await saveBlob(`sessions/${sessionId}/session-${sessionId}.json`, Buffer.from(JSON.stringify(manifest,null,2)), { contentType:'application/json' })

    // Build email HTML
    if (email){
      const rows = turns.map(t=>`<tr>
        <td style="padding:6px 8px;border:1px solid #eee;">${t.turn}</td>
        <td style="padding:6px 8px;border:1px solid #eee;"><a href="${t.audio}">Audio</a></td>
        <td style="padding:6px 8px;border:1px solid #eee;"><a href="${t.manifest}">Manifest</a></td>
        <td style="padding:6px 8px;border:1px solid #eee;">${(t.transcript||'').slice(0,120)}</td>
      </tr>`).join('')
      const html = `<p>Your session is finalized. Here are your links.</p>
        <p><a href="${manifestUrl}">Session manifest JSON</a></p>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #eee;">
          <tr><th style="padding:6px 8px;border:1px solid #eee;">Turn</th><th style="padding:6px 8px;border:1px solid #eee;">Audio</th><th style="padding:6px 8px;border:1px solid #eee;">Manifest</th><th style="padding:6px 8px;border:1px solid #eee;">Transcript (first 120 chars)</th></tr>
          ${rows}
        </table>`
      await sendSummaryEmail(email, "Dad’s Interview Bot — Session Summary", html)
    }

    return res.status(200).json({ ok:true, manifestUrl, totalTurns: totals.turns, totalDurationMs: totals.durationMs })
  }catch(e){
    return res.status(200).json({ ok:false, error:String(e) })
  }
}
