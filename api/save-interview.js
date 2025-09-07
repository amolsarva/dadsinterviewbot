import { put } from '@vercel/blob'
export const runtime = 'edge'

async function emailLinks({ apiKey, fromEmail, toEmail, id, audioUrl, transcriptUrl, timestamp }) {
  if(!apiKey || !fromEmail) return
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      personalizations:[{ to:[{ email: toEmail }] }],
      from:{ email: fromEmail, name: 'Dad's Interview Bot' },
      subject: 'Your Interview Recording & Transcript',
      content:[{ type:'text/html', value: `<h2>Your Interview</h2>
        <p><b>ID:</b> ${id}</p>
        <p><b>Date:</b> ${new Date(timestamp).toLocaleString()}</p>
        <ul><li><a href="${audioUrl}">Audio</a></li><li><a href="${transcriptUrl}">Transcript</a></li></ul>` }]
    })
  })
  if(!res.ok){ /* ignore email errors */ }
}

export default async function handler(req){
  if(req.method!=='POST') return new Response('Method Not Allowed',{status:405})
  try{
    const form = await req.formData()
    const email = form.get('email') || 'a@sarva.co'
    const transcript = form.get('transcript') || '(no transcript)'
    const audio = form.get('audio')
    const timestamp = form.get('timestamp') || new Date().toISOString()
    if(!audio) return new Response('Missing audio',{status:400})
    const id = crypto.randomUUID()
    const base = `interviews/${id}`
    const { url: audioUrl } = await put(`${base}.webm`, audio, { access:'public', addRandomSuffix:false, contentType: audio.type || 'audio/webm' })
    const { url: transcriptUrl } = await put(`${base}.txt`, transcript, { access:'public', addRandomSuffix:false, contentType:'text/plain; charset=utf-8' })
    await put(`${base}.json`, JSON.stringify({ id, email, timestamp, audioUrl, transcriptUrl }, null, 2), { access:'public', addRandomSuffix:false, contentType:'application/json' })

    await emailLinks({ apiKey: process.env.SENDGRID_API_KEY, fromEmail: process.env.FROM_EMAIL || 'noreply@example.com',
      toEmail: email, id, audioUrl, transcriptUrl, timestamp })

    return new Response(JSON.stringify({ ok:true, id, audioUrl, transcriptUrl, timestamp }), { status:200, headers:{ 'Content-Type':'application/json' } })
  }catch(err){
    return new Response('Error: '+err.message, { status:500 })
  }
}
