const SG = 'https://api.sendgrid.com/v3/mail/send'
export async function sendSummaryEmail(to, subject, html){
  const key = process.env.SENDGRID_API_KEY
  const from = process.env.MAIL_FROM || 'bot@example.com'
  if (!key) return { skipped:true }
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from },
    subject,
    content: [{ type: 'text/html', value: html }]
  }
  const r = await fetch(SG, {
    method:'POST',
    headers:{ 'Authorization': `Bearer ${key}`, 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  })
  return { ok: r.ok, status: r.status }
}
