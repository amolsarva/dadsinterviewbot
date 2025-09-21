import { NextResponse } from 'next/server'
import { appendTurn, createSession, finalizeSession } from '@/lib/data'
import { listFoxes } from '@/lib/foxes'
import { DEFAULT_USER_ID } from '@/lib/users'

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
    const userId = DEFAULT_USER_ID
    const session = await wrapStage('create_session', () =>
      createSession(userId, { email_to: process.env.DEFAULT_NOTIFY_EMAIL || 'a@sarva.co' })
    )

    await wrapStage('append_user_turn', () =>
      appendTurn(userId, session.id, { role: 'user', text: 'Hello world' } as any)
    )

    await wrapStage('append_assistant_turn', () =>
      appendTurn(userId, session.id, { role: 'assistant', text: 'Tell me more about that.' } as any)
    )

    const result = await wrapStage('finalize_session', () =>
      finalizeSession(userId, session.id, { clientDurationMs: 1500 })
    )

    return NextResponse.json({ ok: true, sessionId: session.id, result, foxes: listFoxes() })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'e2e_failed',
        stage: error?.diagnosticStage || 'unknown',
        foxes: listFoxes(),
      },
      { status: 500 }
    )
  }
}

