type Session = {
  id: string
  created_at: string
  title?: string
  email_to: string
  status: 'in_progress'|'completed'|'emailed'|'error'
  duration_ms: number
  total_turns: number
  artifacts?: Record<string, string>
  turns?: Turn[]
}
type Turn = {
  id: string
  role: 'user'|'assistant'
  text: string
  audio_blob_url?: string
}

const mem = {
  sessions: new Map<string, Session>(),
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function dbHealth() {
  return { ok: true, mode: 'memory' }
}

export async function createSession({ email_to }:{ email_to: string}): Promise<Session> {
  const s: Session = {
    id: uid(),
    created_at: new Date().toISOString(),
    email_to,
    status: 'in_progress',
    duration_ms: 0,
    total_turns: 0,
    turns: [],
    artifacts: {},
  }
  mem.sessions.set(s.id, s)
  return s
}

export async function appendTurn(id: string, turn: Partial<Turn>) {
  const s = mem.sessions.get(id)
  if (!s) throw new Error('Session not found')
  const t: Turn = { id: uid(), role: (turn.role as any) || 'user', text: turn.text || '', audio_blob_url: turn.audio_blob_url }
  s.turns!.push(t)
  s.total_turns = s.turns!.length
  return t
}

export async function finalizeSession(id: string, body: any) {
  const s = mem.sessions.get(id)
  if (!s) throw new Error('Session not found')
  s.status = 'completed'
  s.duration_ms = body?.duration_ms || 0
  // Pretend artifacts were written
  s.artifacts = {
    transcript_txt: `data:text/plain;base64,${Buffer.from((s.turns||[]).map(t=>`${t.role}: ${t.text}`).join('\n')).toString('base64')}`
  }
  mem.sessions.set(id, s)
  return { ok: true, session: s }
}

export async function listSessions(): Promise<Session[]> {
  return Array.from(mem.sessions.values()).sort((a,b)=> (a.created_at < b.created_at ? 1 : -1))
}

export async function getSession(id: string): Promise<Session | undefined> {
  return mem.sessions.get(id)
}
