// api/save-interview.js
import { put } from '@vercel/blob'

export const runtime = 'edge' // <- explicit Edge runtime

async function sendEmail({ apiKey, fromEmail, toEmail, subject, html }) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail, name: 'AI Interview Assistant' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  })
  if (!res.ok) throw new Error(`SendGrid: ${res.status} ${await res.text()}`)
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  try {
    const form = await req.formData()
    const email = form.get('email')
    const transcript = form.get('transcript') || '(no transcript)'
    const audioFile = form.get('audio')
    const timestamp = form.get('timestamp') || new Date().toISOString()

    if (!email || !audioFile) return new Response('Missing fields', { status: 400 })

    const id = crypto.randomUUID()
    const base = `interviews/${id}`

    const { url: audioUrl } = await put(`${base}.webm`, audioFile, {
      access: 'public',
      addRandomSuffix: false,
      contentType: audioFile.type || 'audio/webm',
    })

    const { url: transcriptUrl } = await put(`${base}.txt`, transcript, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'text/plain; charset=utf-8',
    })

    // Optional metadata record for convenience
    await put(`${base}.json`, JSON.stringify({ id, email, timestamp, audioUrl, transcriptUrl }, null, 2), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    })

    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
    const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@example.com'
    if (SENDGRID_API_KEY && FROM_EMAIL) {
      await sendEmail({
        apiKey: SENDGRID_API_KEY,
        fromEmail: FROM_EMAIL,
        toEmail: email,
        subject: 'Your AI Interview Recording & Transcript',
        html: `
          <h2>Your AI Interview is Ready</h2>
          <p><b>ID:</b> ${id}</p>
          <p><b>Date:</b> ${new Date(timestamp).toLocaleString()}</p>
          <ul>
            <li><a href="${audioUrl}">Audio (.webm)</a></li>
            <li><a href="${transcriptUrl}">Transcript (.txt)</a></li>
          </ul>
        `,
      })
    }

    return new Response(JSON.stringify({ ok: true, id, audioUrl, transcriptUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(`Error: ${err.message}`, { status: 500 })
  }
}