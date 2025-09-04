export const config = { runtime: 'edge' }
import { put } from '@vercel/blob'

async function sendEmail({ apiKey, fromEmail, toEmail, subject, html }) {
  const url = 'https://api.sendgrid.com/v3/mail/send'
  const body = {
    personalizations: [{ to: [{ email: toEmail }] }],
    from: { email: fromEmail, name: 'AI Interview Assistant' },
    subject,
    content: [{ type: 'text/html', value: html }]
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(await res.text())
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  try {
    const form = await req.formData()
    const email = form.get('email')
    const timestamp = form.get('timestamp')
    const transcript = form.get('transcript')
    const audioFile = form.get('audio')
    const id = crypto.randomUUID()
    const baseKey = `interviews/${id}`

    const { url: audioUrl } = await put(`${baseKey}.webm`, audioFile, { access: 'public', addRandomSuffix: false })
    const { url: transcriptUrl } = await put(`${baseKey}.txt`, transcript, { access: 'public', addRandomSuffix: false })

    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
    const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@example.com'
    if (SENDGRID_API_KEY) {
      const subject = 'Your AI Interview Recording & Transcript'
      const html = `<h2>Your AI Interview</h2><ul><li><a href="${audioUrl}">Audio</a></li><li><a href="${transcriptUrl}">Transcript</a></li></ul>`
      await sendEmail({ apiKey: SENDGRID_API_KEY, fromEmail: FROM_EMAIL, toEmail: email, subject, html })
    }

    return new Response(JSON.stringify({ ok: true, id, audioUrl, transcriptUrl }), { status: 200 })
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 })
  }
}
