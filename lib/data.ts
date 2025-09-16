import { putBlobFromBuffer, listBlobs } from './blob'
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

function inlineAwareLabel(label: string, value: string | undefined | null) {
  if (!value) return `${label}: unavailable`
  if (value.startsWith('data:')) return `${label}: [inline]`
  return `${label}: ${value}`
}

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

  const transcriptTxtUrl = txtBlob.downloadUrl || txtBlob.url
  const transcriptJsonUrl = jsonBlob.downloadUrl || jsonBlob.url

  s.artifacts = {
    transcript_txt: transcriptTxtUrl,
    transcript_json: transcriptJsonUrl,
  }
  s.total_turns = turns.length

  const manifestBody = {
    sessionId: s.id,
    created_at: s.created_at,
    email: s.email_to,
    totals: { turns: turns.length, durationMs: s.duration_ms },
    turns: turns.map((t) => ({ id: t.id, role: t.role, text: t.text, audio: t.audio_blob_url || null })),
    artifacts: s.artifacts,
  }
  const manifestBlob = await putBlobFromBuffer(
    `sessions/${s.id}/session-${s.id}.json`,
    Buffer.from(JSON.stringify(manifestBody, null, 2), 'utf8'),
    'application/json'
  )
  const manifestUrl = manifestBlob.downloadUrl || manifestBlob.url
  s.artifacts.session_manifest = manifestUrl

  const manifestForMemory = {
    ...manifestBody,
    artifacts: { ...manifestBody.artifacts, session_manifest: manifestUrl },
  }
  rememberSessionManifest(manifestForMemory, s.id, s.created_at, manifestUrl)

  const date = new Date(s.created_at).toLocaleString()
  const bodyText = [
    `Your interview session (${date})`,
    `Turns: ${s.total_turns}`,
    `Duration: ${Math.round(s.duration_ms/1000)}s`,
    inlineAwareLabel('Transcript (txt)', s.artifacts.transcript_txt),
    inlineAwareLabel('Transcript (json)', s.artifacts.transcript_json),
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
  const seen = new Map<string, Session>()
  for (const session of mem.sessions.values()) {
    seen.set(session.id, { ...session, turns: session.turns ? [...session.turns] : [] })
  }

  try {
    const { blobs } = await listBlobs({ prefix: 'sessions/', limit: 2000 })
    const manifests = blobs.filter((b) => /session-.+\.json$/.test(b.pathname))
    for (const manifest of manifests) {
      try {
        const url = manifest.downloadUrl || manifest.url
        const resp = await fetch(url)
        if (!resp.ok) continue
        const data = await resp.json()
        const fallbackId = manifest.pathname.replace(/^sessions\//, '').split('/')[0] || data?.sessionId
        const uploadedAt =
          manifest.uploadedAt instanceof Date
            ? manifest.uploadedAt.toISOString()
            : typeof manifest.uploadedAt === 'string'
            ? manifest.uploadedAt
            : undefined
        const storedId = rememberSessionManifest(data, fallbackId, uploadedAt, url)
        const stored = storedId ? mem.sessions.get(storedId) : fallbackId ? mem.sessions.get(fallbackId) : undefined
        if (stored) {
          seen.set(stored.id, { ...stored, turns: stored.turns ? [...stored.turns] : [] })
          continue
        }
        const derived = buildSessionFromManifest(data, fallbackId, uploadedAt)
        if (derived) {
          seen.set(derived.id, derived)
        }
      } catch (err) {
        console.warn('Failed to parse session manifest', err)
      }
    }
  } catch (err) {
    console.warn('Failed to list session manifests', err)
  }

  return Array.from(seen.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export async function getSession(id: string): Promise<Session | undefined> {
  const inMemory = mem.sessions.get(id)
  if (inMemory) return inMemory

  const manifest = await fetchSessionManifest(id)
  if (manifest) {
    const storedId = rememberSessionManifest(manifest.data, manifest.id, manifest.uploadedAt, manifest.url)
    const stored = storedId ? mem.sessions.get(storedId) : mem.sessions.get(manifest.id)
    if (stored) return stored
    const derived = buildSessionFromManifest(
      manifest.data,
      manifest.id,
      manifest.uploadedAt
    )
    if (derived) return derived
  }

  return undefined
}

type ManifestLookup = { id: string; uploadedAt?: string; url: string; data: any }

async function fetchSessionManifest(sessionId: string): Promise<ManifestLookup | null> {
  try {
    const { blobs } = await listBlobs({ prefix: `sessions/${sessionId}/`, limit: 25 })
    const manifest = blobs.find((b) => /session-.+\.json$/.test(b.pathname))
    if (!manifest) return null
    const url = manifest.downloadUrl || manifest.url
    const resp = await fetch(url)
    if (!resp.ok) return null
    const data = await resp.json()
    return {
      id: (typeof data?.sessionId === 'string' && data.sessionId) || sessionId,
      uploadedAt:
        manifest.uploadedAt instanceof Date
          ? manifest.uploadedAt.toISOString()
          : typeof manifest.uploadedAt === 'string'
          ? manifest.uploadedAt
          : undefined,
      url,
      data,
    }
  } catch (err) {
    console.warn('Failed to fetch session manifest', err)
    return null
  }
}

export function rememberSessionManifest(
  manifest: any,
  fallbackId?: string,
  fallbackCreatedAt?: string,
  manifestUrl?: string
): string | undefined {
  const derived = buildSessionFromManifest(manifest, fallbackId, fallbackCreatedAt)
  if (!derived) return
  if (manifestUrl) {
    derived.artifacts = { ...(derived.artifacts || {}), session_manifest: manifestUrl }
  }
  mem.sessions.set(derived.id, {
    ...derived,
    turns: derived.turns ? [...derived.turns] : [],
  })
  return derived.id
}

function buildSessionFromManifest(data: any, fallbackId?: string, fallbackCreatedAt?: string): Session | undefined {
  if (!data || typeof data !== 'object') return undefined
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : fallbackId
  if (!sessionId) return undefined

  const startedAt = typeof data.startedAt === 'string' ? data.startedAt : undefined
  const endedAt = typeof data.endedAt === 'string' ? data.endedAt : undefined
  const createdAt = startedAt || endedAt || fallbackCreatedAt || new Date().toISOString()

  const artifactRecord: Record<string, string> = {}
  if (data.artifacts && typeof data.artifacts === 'object') {
    for (const [key, value] of Object.entries(data.artifacts as Record<string, unknown>)) {
      if (typeof value === 'string') artifactRecord[key] = value
    }
  }

  const turnEntries = Array.isArray(data.turns) ? data.turns : []
  const turns: Turn[] = []
  let highestTurnNumber = 0
  for (const entry of turnEntries) {
    if (!entry || typeof entry !== 'object') continue
    const turnNumber = Number((entry as any).turn) || highestTurnNumber + 1
    if (turnNumber > highestTurnNumber) highestTurnNumber = turnNumber
    const transcript = typeof (entry as any).transcript === 'string' ? (entry as any).transcript : ''
    const audio =
      typeof (entry as any).audio === 'string'
        ? (entry as any).audio
        : typeof (entry as any).userAudioUrl === 'string'
        ? (entry as any).userAudioUrl
        : undefined
    if (transcript) {
      turns.push({ id: `user-${turnNumber}`, role: 'user', text: transcript, audio_blob_url: audio })
    }
    const assistantReply = extractAssistantReply(entry)
    if (assistantReply) {
      turns.push({ id: `assistant-${turnNumber}`, role: 'assistant', text: assistantReply })
    }
  }

  const totals = typeof data.totals === 'object' && data.totals ? (data.totals as any) : {}
  const totalTurns = Number(totals.turns) || highestTurnNumber || Math.ceil(turns.length / 2)
  const durationMs = Number(totals.durationMs) || 0

  const session: Session = {
    id: sessionId,
    created_at: createdAt,
    title: typeof data.title === 'string' ? data.title : undefined,
    email_to: typeof data.email === 'string' ? data.email : process.env.DEFAULT_NOTIFY_EMAIL || '',
    status: 'completed',
    duration_ms: durationMs,
    total_turns: totalTurns,
    artifacts: Object.keys(artifactRecord).length ? artifactRecord : undefined,
    turns,
  }

  if (typeof data.status === 'string') {
    if (data.status === 'emailed' || data.status === 'in_progress' || data.status === 'error') {
      session.status = data.status
    }
  }

  return session
}

function extractAssistantReply(entry: any): string {
  if (!entry || typeof entry !== 'object') return ''
  const candidates = [entry.assistantReply, entry.reply, entry.assistant?.reply, entry.assistant?.text]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length) return value
  }
  return ''
}
