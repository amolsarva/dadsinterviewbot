import { Resend } from 'resend'

export async function sendSummaryEmail(to: string, subject: string, body: string) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY missing — skipping email.')
    return { skipped: true }
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'noreply@interviewbot.local',
    to,
    subject,
    text: body,
  })
  return { ok: true }
}
