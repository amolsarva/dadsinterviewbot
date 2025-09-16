import { putBlobFromBuffer } from './blob'
import { sendSummaryEmail } from './email'

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

// Ensure the in-memory store survives hot reloads/dev and is shared across route invocations
const globalKey = '__dads_interview_mem__'
// @ts-ignore
const g: any = globalThis as any
if (!g[globalKey]) {
  // @ts-ignore
  g[globalKey] = { sessions: new Map<string, Session>() }
}
// @ts-ignore
const mem: { sessions: Map<string, Session> } = g[globalKey]

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

export async function dbHealth() { return { ok: true, mode: 'memory' } }

export async function createSession({ email_to }:{ email_to: string}): Promise<Session> {
  const s: Session = {
    id: uid(),
    created_at: new Date().toISOString(),
    email_to, status: 'in_progress',
    duration_ms: 0, total_turns: 0, turns: [], artifacts: {},
  }
  mem.sessions.set(s.id, s)
  return s
}

export async function appendTurn(id: string, turn: Partial<Turn>) {
  const s = mem.sessions.get(id)
  if (!s) throw new Error('Session not found')
  const t: Turn = { id: uid(), role: (turn.role as any) || 'user', text: turn.text || '', audio_blob_url: turn.audio_blob_url }
  s.turns!.push(t); s.total_turns = s.turns!.length
  return t
}

export async function finalizeSession(id: string, body: { clientDurationMs: number }) {
  const s = mem.sessions.get(id)
  if (!s) throw new Error('Session not found')
  const turns = s.turns || []
  const safeDuration = Math.max(0, Math.min(body.clientDurationMs || 0, 6 * 60 * 60 * 1000))
  s.duration_ms = safeDuration
  s.status = 'completed'

  const txt = turns.map(t => `${t.role}: ${t.text}`).join('\n')
  const jsonObj = { sessionId: s.id, created_at: s.created_at, total_turns: turns.length, turns }
  const txtBuf = Buffer.from(txt, 'utf8')
  const jsonBuf = Buffer.from(JSON.stringify(jsonObj, null, 2), 'utf8')

  const txtBlob = await putBlobFromBuffer(`transcripts/${s.id}.txt`, txtBuf, 'text/plain; charset=utf-8')
  const jsonBlob = await putBlobFromBuffer(`transcripts/${s.id}.json`, jsonBuf, 'application/json')

  s.artifacts = { transcript_txt: txtBlob.url, transcript_json: jsonBlob.url }
  s.total_turns = turns.length

  const date = new Date(s.created_at).toLocaleString()
  const bodyText = [
    `Your interview session (${date})`,
    `Turns: ${s.total_turns}`,
    `Duration: ${Math.round(s.duration_ms/1000)}s`,
    `Transcript (txt): ${s.artifacts.transcript_txt}`,
    `Transcript (json): ${s.artifacts.transcript_json}`,
  ].join('\n')
  let emailStatus: Awaited<ReturnType<typeof sendSummaryEmail>> | { ok: false; provider: 'unknown'; error: string }
  try {
    emailStatus = await sendSummaryEmail(s.email_to, `Interview session – ${date}`, bodyText)
  } catch (e:any) {
    emailStatus = { ok: false, provider: 'unknown', error: e?.message || 'send_failed' }
  }

  if ('ok' in emailStatus && emailStatus.ok) {
    s.status = 'emailed'
  } else if ('skipped' in emailStatus && emailStatus.skipped) {
    s.status = 'completed'
  } else {
    s.status = 'error'
  }

  mem.sessions.set(id, s)

  const emailed = 'ok' in emailStatus && emailStatus.ok
  return { ok: true, session: s, emailed, emailStatus }
}

export async function listSessions(): Promise<Session[]> {
  return Array.from(mem.sessions.values()).sort((a,b)=> (a.created_at < b.created_at ? 1 : -1))
}
export async function getSession(id: string): Promise<Session | undefined> { return mem.sessions.get(id) }
