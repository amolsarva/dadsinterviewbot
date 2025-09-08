import { getSession, putSession } from './_kv'
import { saveBlob } from './_blob'
import { sendSummaryEmail } from './_email'

export const config = { runtime: 'edge' }

export default async function handler(req){
  let body = {}
  try { body = await req.json() } catch {}
  const { sessionId } = body || {}
  const s = await getSession(sessionId)
  if (!s) return new Response(JSON.stringify({ ok:false, error:'no session' }), { status:404, headers:{'Content-Type':'application/json'} })
  s.endedAt = new Date().toISOString()
  s.totals = s.totals || { turns: s.turns?.length || 0, durationMs: 0 }

  const manifest = { sessionId:s.sessionId, email:s.email||null, startedAt:s.startedAt, endedAt:s.endedAt, turns:s.turns||[], totals:s.totals }
  const manifestBlob = new Blob([JSON.stringify(manifest,null,2)], { type:'application/json' })
  const manifestUrl = await saveBlob(`sessions/${sessionId}/session-${sessionId}.json`, manifestBlob, { contentType:'application/json' })
  s.manifestUrl = manifestUrl
  await putSession(s)

  if (s.email){
    const rows = (s.turns||[]).map(t=>`<tr><td style="padding:6px 8px;border:1px solid #eee;">${t.turn}</td><td style="padding:6px 8px;border:1px solid #eee;"><a href="${t.audio}">Audio</a></td><td style="padding:6px 8px;border:1px solid #eee;"><a href="${t.manifest}">Manifest</a></td></tr>`).join('')
    const html = `<p>Here are your session links.</p>
      <p><b>Total turns:</b> ${s.totals?.turns||0}</p>
      <p><a href="${manifestUrl}">Session manifest JSON</a></p>
      <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #eee;">
        <tr><th style="padding:6px 8px;border:1px solid #eee;">Turn</th><th style="padding:6px 8px;border:1px solid #eee;">Audio</th><th style="padding:6px 8px;border:1px solid #eee;">Manifest</th></tr>
        ${rows}
      </table>`
    try { await sendSummaryEmail(s.email, "Dad’s Interview Bot — Session Summary", html) } catch {}
  }

  return new Response(JSON.stringify({ ok:true, manifestUrl, totalTurns:s.totals?.turns||0, totalDurationMs:s.totals?.durationMs||0 }), { status:200, headers:{'Content-Type':'application/json'} })
}
