import type { NextApiRequest, NextApiResponse } from 'next'
import { appendTurn, createSession, finalizeSession } from '@/lib/data'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'method_not_allowed' })
  }

  try {
    const session = await createSession({
      email_to: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co',
    })
    await appendTurn(session.id, { role: 'user', text: 'Hello world' } as any)
    await appendTurn(session.id, { role: 'assistant', text: 'Tell me more about that.' } as any)
    const result = await finalizeSession(session.id, { clientDurationMs: 5000 })

    return res.status(200).json({
      ok: true,
      sessionId: session.id,
      artifacts: result.session.artifacts,
      emailed: result.emailed,
    })
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'smoke_failed' })
  }
}
