import type { NextApiRequest, NextApiResponse } from 'next'
import { sendSummaryEmail } from '@/lib/email'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'method_not_allowed' })
  }

  try {
    const to = process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co'
    const subject = 'Interview Bot – Test Email'
    const body = 'This is a test email from /api/diagnostics/email.'
    const status = await sendSummaryEmail(to, subject, body)

    return res.status(200).json({ ok: true, status })
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'email_failed' })
  }
}
