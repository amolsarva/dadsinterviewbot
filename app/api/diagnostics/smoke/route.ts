import { NextResponse } from 'next/server'
import { createSession, appendTurn, finalizeSession } from '@/lib/data'
import { listFoxes } from '@/lib/foxes'

export const runtime = 'nodejs'

type Stage =
  | 'create_session'
  | 'append_user_turn'
  | 'append_assistant_turn'
  | 'finalize_session'

function wrapStage<T>(stage: Stage, task: () => Promise<T>): Promise<T> {
  return task().catch(err => {
    const error = err instanceof Error ? err : new Error(String(err))
    ;(error as any).diagnosticStage = stage
    throw error
  })
}

export async function POST() {
  try {
    const session = await wrapStage('create_session', () =>
      createSession({ email_to: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co' })
    )

    await wrapStage('append_user_turn', () =>
      appendTurn(session.id, { role: 'user', text: 'Hello world' } as any)
    )

    await wrapStage('append_assistant_turn', () =>
      appendTurn(session.id, { role: 'assistant', text: 'Tell me more about that.' } as any)
    )

    const result = await wrapStage('finalize_session', () =>
      finalizeSession(session.id, { clientDurationMs: 5000 })
    )

    if ('skipped' in result && result.skipped) {
      return NextResponse.json({ ok: true, sessionId: session.id, skipped: true, foxes: listFoxes() })
    }

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      artifacts: result.session.artifacts,
      emailed: result.emailed,
      foxes: listFoxes(),
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'smoke_failed',
        stage: error?.diagnosticStage || 'unknown',
        foxes: listFoxes(),
      },
      { status: 500 }
    )
  }
}
