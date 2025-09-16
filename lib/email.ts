import { Resend } from 'resend'

export async function sendSummaryEmail(to: string, subject: string, body: string) {
  const from = process.env.MAIL_FROM || 'noreply@example.com'

  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({ from, to, subject, text: body })
      return { ok: true, provider: 'resend' }
    } catch (e:any) {
      return { ok: false, provider: 'resend', error: e?.message || 'resend_failed' }
    }
  }

  if (process.env.SENDGRID_API_KEY) {
    try {
      const sg = require('@sendgrid/mail')
      sg.setApiKey(process.env.SENDGRID_API_KEY)
      await sg.send({ to, from, subject, text: body })
      return { ok: true, provider: 'sendgrid' }
    } catch (e:any) {
      return { ok: false, provider: 'sendgrid', error: e?.message || 'sendgrid_failed' }
    }
  }

  console.warn('No email provider configured — skipping email.')
  return { skipped: true }
}
