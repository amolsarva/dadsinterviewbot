import { putBlobFromBuffer, listBlobs, deleteBlobsByPrefix, deleteBlob } from './blob'
import { sendSummaryEmail } from './email'
import { flagFox } from './foxes'
import { generateSessionTitle, SummarizableTurn } from './session-title'
import { buildUserScopedPath, normalizeUserId } from './users'

export type Session = {
  id: string
  created_at: string
  title?: string
  email_to: string
  status: 'in_progress' | 'completed' | 'emailed' | 'error'
  duration_ms: number
  total_turns: number
  artifacts?: Record<string, string>
  turns?: Turn[]
}

export type Turn = {
  id: string
  role: 'user' | 'assistant'
  text: string
  audio_blob_url?: string
}

type SessionPatch = {
  artifacts?: Record<string, string | null | undefined>
  totalTurns?: number
  durationMs?: number
  status?: Session['status']
}

type ManifestLookup = { id: string; uploadedAt?: string; url: string; data: any }

type RememberedSession = Session & { turns?: Turn[] }

type UserMemoryState = {
  sessions: Map<string, RememberedSession>
  bootedAt: string
  primerState: { text: string; url?: string; updatedAt?: string; loaded: boolean }
  hydrationState: { attempted: boolean; hydrated: boolean }
  hydrationPromise: Promise<void> | null
  primerLoadPromise: Promise<void> | null
}

const GLOBAL_STATE_KEY = '__dads_interview_user_memories__'
const g: any = globalThis as any
if (!g[GLOBAL_STATE_KEY]) {
  g[GLOBAL_STATE_KEY] = new Map<string, UserMemoryState>()
}
const userStates: Map<string, UserMemoryState> = g[GLOBAL_STATE_KEY]

function ensureUserState(rawUserId: string): { userId: string; state: UserMemoryState } {
  const userId = normalizeUserId(rawUserId)
  let state = userStates.get(userId)
  if (!state) {
    state = {
      sessions: new Map<string, RememberedSession>(),
      bootedAt: new Date().toISOString(),
      primerState: { text: '', url: undefined, updatedAt: undefined, loaded: false },
      hydrationState: { attempted: false, hydrated: false },
      hydrationPromise: null,
      primerLoadPromise: null,
    }
    userStates.set(userId, state)
  }
  return { userId, state }
}

function resetPrimerState(state: UserMemoryState) {
  state.primerState.text = ''
  state.primerState.url = undefined
  state.primerState.updatedAt = undefined
  state.primerState.loaded = false
}

const MEMORY_PRIMER_SUFFIX = 'memory/MemoryPrimer.txt'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function inlineAwareLabel(label: string, value: string | undefined | null) {
  if (!value) return `${label}: unavailable`
  if (value.startsWith('data:')) return `${label}: [inline]`
  return `${label}: ${value}`
}

function safeDateString(value: string | undefined) {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

function formatDateTime(value: string | undefined) {
  if (!value) return 'Unknown time'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function truncateSnippet(text: string, limit = 180) {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length <= limit) return cleaned
  const slice = cleaned.slice(0, limit - 1)
  const lastSpace = slice.lastIndexOf(' ')
  if (lastSpace > 40) {
    return `${slice.slice(0, lastSpace)}…`
  }
  return `${slice}…`
}

function collectPrimerHighlights(session: RememberedSession): string[] {
  const highlights: string[] = []
  const userTurns = (session.turns || []).filter((turn) => turn.role === 'user' && turn.text && turn.text.trim().length)
  const assistantTurns = (session.turns || []).filter(
    (turn) => turn.role === 'assistant' && turn.text && turn.text.trim().length,
  )

  const snippets: { label: string; text: string }[] = []
  if (userTurns.length) {
    snippets.push({ label: 'User opened with', text: userTurns[0].text })
    if (userTurns.length > 2) {
      snippets.push({ label: 'User reflected', text: userTurns[Math.floor(userTurns.length / 2)].text })
    }
    if (userTurns.length > 1) {
      snippets.push({ label: 'User added', text: userTurns[userTurns.length - 1].text })
    }
  }
  if (assistantTurns.length) {
    snippets.push({ label: 'Assistant responded', text: assistantTurns[assistantTurns.length - 1].text })
  }

  const seen = new Set<string>()
  for (const snippet of snippets) {
    const trimmed = truncateSnippet(snippet.text)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    highlights.push(`- ${snippet.label}: ${trimmed}`)
    if (highlights.length >= 4) break
  }

  return highlights
}

async function hydrateSessionsFromBlobs(userId: string, state: UserMemoryState) {
  try {
    const prefix = buildUserScopedPath(userId, 'sessions/')
    const { blobs } = await listBlobs({ prefix, limit: 2000 })
    const manifests = blobs.filter((b) => /session-.+\.json$/.test(b.pathname))
    for (const manifest of manifests) {
      try {
        const url = manifest.downloadUrl || manifest.url
        const resp = await fetch(url)
        if (!resp.ok) continue
        const data = await resp.json()
        const relativePath = manifest.pathname.startsWith(prefix)
          ? manifest.pathname.slice(prefix.length)
          : manifest.pathname
        const fallbackId = relativePath.split('/')[0] || data?.sessionId
        const uploadedAt =
          manifest.uploadedAt instanceof Date
            ? manifest.uploadedAt.toISOString()
            : typeof manifest.uploadedAt === 'string'
            ? manifest.uploadedAt
            : undefined
        const storedId = rememberSessionManifest(userId, data, fallbackId, uploadedAt, url)
        if (storedId) continue
        if (fallbackId && state.sessions.has(fallbackId)) continue
        const derived = buildSessionFromManifest(data, fallbackId, uploadedAt)
        if (derived) {
          state.sessions.set(derived.id, { ...derived, turns: derived.turns ? [...derived.turns] : [] })
        }
      } catch (err) {
        console.warn('Failed to parse session manifest', err)
      }
    }
    state.hydrationState.hydrated = true
  } catch (err) {
    console.warn('Failed to list session manifests', err)
  } finally {
    state.hydrationState.attempted = true
  }
}

async function ensurePrimerLoadedFromStorage(userId: string, state: UserMemoryState) {
  if (state.primerState.loaded && state.primerState.text) return
  if (state.primerLoadPromise) {
    await state.primerLoadPromise
    return
  }
  state.primerLoadPromise = (async () => {
    try {
      const { blobs } = await listBlobs({ prefix: buildUserScopedPath(userId, 'memory/'), limit: 20 })
      const expectedPath = buildUserScopedPath(userId, MEMORY_PRIMER_SUFFIX)
      const primerBlob = blobs.find((blob) => blob.pathname === expectedPath)
      if (!primerBlob) return
      const url = primerBlob.downloadUrl || primerBlob.url
      const resp = await fetch(url)
      if (!resp.ok) return
      const text = await resp.text()
      state.primerState.text = text
      state.primerState.url = url
      state.primerState.updatedAt = safeDateString(
        primerBlob.uploadedAt instanceof Date
          ? primerBlob.uploadedAt.toISOString()
          : typeof primerBlob.uploadedAt === 'string'
          ? primerBlob.uploadedAt
          : undefined,
      )
    } catch (err) {
      console.warn('Failed to load memory primer from storage', err)
    } finally {
      state.primerState.loaded = true
    }
  })()
  try {
    await state.primerLoadPromise
  } finally {
    state.primerLoadPromise = null
  }
}

export async function ensureSessionMemoryHydrated(rawUserId: string) {
  const { userId, state } = ensureUserState(rawUserId)
  if (state.hydrationState.hydrated) return
  if (!state.hydrationPromise) {
    state.hydrationPromise = (async () => {
      try {
        await hydrateSessionsFromBlobs(userId, state)
      } finally {
        state.hydrationPromise = null
      }
    })()
  }
  if (state.hydrationPromise) {
    await state.hydrationPromise
  }
}

export async function getMemoryPrimer(
  rawUserId: string,
): Promise<{ text: string; url?: string; updatedAt?: string }> {
  const { userId, state } = ensureUserState(rawUserId)
  if (!state.primerState.loaded || !state.primerState.text) {
    await ensurePrimerLoadedFromStorage(userId, state)
  }
  if (!state.primerState.text) {
    const sessionsWithContent = Array.from(state.sessions.values()).filter((session) =>
      (session.turns || []).some((turn) => typeof turn.text === 'string' && turn.text.trim().length),
    )
    if (sessionsWithContent.length) {
      await rebuildMemoryPrimer(userId)
    }
  }
  return {
    text: state.primerState.text,
    url: state.primerState.url,
    updatedAt: state.primerState.updatedAt,
  }
}

function buildMemoryPrimerFromSessions(sessions: RememberedSession[]): string {
  const sorted = [...sessions].sort((a, b) => (a.created_at > b.created_at ? 1 : -1))
  const lines: string[] = []
  lines.push('# Memory Primer')
  lines.push(`Updated: ${formatDateTime(new Date().toISOString())}`)
  lines.push('')
  if (!sorted.length) {
    lines.push('No conversations have been recorded yet.')
    return lines.join('\n')
  }

  for (const session of sorted) {
    const title = session.title || `Session from ${formatDateTime(session.created_at)}`
    lines.push(`## ${title}`)
    lines.push(`- Started: ${formatDateTime(session.created_at)}`)
    const highlights = collectPrimerHighlights(session)
    if (highlights.length) {
      lines.push(...highlights)
    } else {
      lines.push('- No detailed transcript was captured for this session.')
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

export async function rebuildMemoryPrimer(
  rawUserId: string,
): Promise<{ text: string; url?: string; updatedAt?: string }> {
  const { userId, state } = ensureUserState(rawUserId)
  const sessions = Array.from(state.sessions.values())
  const primerText = buildMemoryPrimerFromSessions(sessions)
  const blob = await putBlobFromBuffer(
    buildUserScopedPath(userId, MEMORY_PRIMER_SUFFIX),
    Buffer.from(primerText, 'utf8'),
    'text/plain; charset=utf-8',
    { access: 'public' },
  )
  state.primerState.text = primerText
  state.primerState.url = blob.downloadUrl || blob.url
  state.primerState.updatedAt = new Date().toISOString()
  state.primerState.loaded = true
  return { text: primerText, url: state.primerState.url, updatedAt: state.primerState.updatedAt }
}

export async function dbHealth() {
  return { ok: true, mode: 'memory' }
}

export async function createSession(rawUserId: string, { email_to }: { email_to: string }): Promise<Session> {
  const { userId, state } = ensureUserState(rawUserId)
  await ensureSessionMemoryHydrated(userId).catch(() => undefined)
  await getMemoryPrimer(userId).catch(() => undefined)
  const s: RememberedSession = {
    id: uid(),
    created_at: new Date().toISOString(),
    email_to,
    status: 'in_progress',
    duration_ms: 0,
    total_turns: 0,
    turns: [],
    artifacts: {},
  }
  state.sessions.set(s.id, s)
  if (state.sessions.size === 1) {
    flagFox({
      id: 'theory-1-memory-warmed',
      theory: 1,
      level: 'info',
      message: 'In-memory session store warmed with first session for user.',
      details: { bootedAt: state.bootedAt, sessionId: s.id, userId },
    })
  }
  return s
}

export async function appendTurn(rawUserId: string, id: string, turn: Partial<Turn>) {
  const { userId, state } = ensureUserState(rawUserId)
  const s = state.sessions.get(id)
  if (!s) {
    flagFox({
      id: 'theory-1-memory-miss',
      theory: 1,
      level: 'warn',
      message: 'Attempted to append a turn but the in-memory session was missing.',
      details: { sessionId: id, bootedAt: state.bootedAt, storedSessions: state.sessions.size, userId },
    })
    const error = new Error('Session not found')
    ;(error as any).code = 'SESSION_NOT_FOUND'
    throw error
  }
  const t: Turn = {
    id: uid(),
    role: (turn.role as any) || 'user',
    text: turn.text || '',
    audio_blob_url: turn.audio_blob_url,
  }
  if (!s.turns) s.turns = []
  s.turns.push(t)
  s.total_turns = s.turns.length
  return t
}

export type FinalizeSessionResult =
  | {
      ok: true
      session: Session
      emailed: boolean
      emailStatus: Awaited<ReturnType<typeof sendSummaryEmail>> | { ok: false; provider: 'unknown'; error: string }
      skipped?: false
    }
  | { ok: true; skipped: true; reason: 'session_not_found'; emailed?: false }

export async function finalizeSession(
  rawUserId: string,
  id: string,
  body: { clientDurationMs: number; sessionAudioUrl?: string | null },
): Promise<FinalizeSessionResult> {
  const { userId, state } = ensureUserState(rawUserId)
  await ensureSessionMemoryHydrated(userId).catch(() => undefined)
  const s = state.sessions.get(id)
  if (!s) {
    flagFox({
      id: 'theory-1-finalize-memory-miss',
      theory: 1,
      level: 'error',
      message: 'Finalization attempted after session disappeared from memory.',
      details: { sessionId: id, bootedAt: state.bootedAt, storedSessions: state.sessions.size, userId },
    })
    return { ok: true, skipped: true, reason: 'session_not_found' }
  }

  s.duration_ms = Math.max(0, Number.isFinite(body.clientDurationMs) ? body.clientDurationMs : 0)
  s.status = 'completed'

  const userTurns = (s.turns || []).filter((t) => t.role === 'user')
  const assistantTurns = (s.turns || []).filter((t) => t.role === 'assistant')

  const turns = userTurns.map((userTurn, index) => {
    const assistantTurn = assistantTurns[index]
    return {
      id: userTurn.id,
      role: 'user' as const,
      text: userTurn.text,
      audio: userTurn.audio_blob_url || null,
      assistant: assistantTurn
        ? { id: assistantTurn.id, text: assistantTurn.text, audio: assistantTurn.audio_blob_url || null }
        : null,
    }
  })

  const transcriptLines: string[] = []
  const summaryCandidates: SummarizableTurn[] = []
  for (const turn of turns) {
    transcriptLines.push(`User: ${turn.text}`)
    summaryCandidates.push({ role: 'user', text: turn.text })
    if (turn.assistant) {
      transcriptLines.push(`Assistant: ${turn.assistant.text}`)
      summaryCandidates.push({ role: 'assistant', text: turn.assistant.text })
    }
  }

  const computedTitle = generateSessionTitle(summaryCandidates, {
    fallback: `Session on ${new Date(s.created_at).toLocaleDateString()}`,
  })
  if (computedTitle) {
    s.title = computedTitle
  }

  const txtBuf = Buffer.from(transcriptLines.join('\n'), 'utf8')
  const jsonBuf = Buffer.from(
    JSON.stringify(
      {
        sessionId: s.id,
        created_at: s.created_at,
        turns: turns.map((turn, index) => ({
          index,
          user: { text: turn.text, audio: turn.audio },
          assistant: turn.assistant ? { text: turn.assistant.text, audio: turn.assistant.audio } : null,
        })),
      },
      null,
      2,
    ),
    'utf8',
  )

  const txtBlob = await putBlobFromBuffer(
    buildUserScopedPath(userId, `transcripts/${s.id}.txt`),
    txtBuf,
    'text/plain; charset=utf-8',
    {
      access: 'public',
    },
  )
  const jsonBlob = await putBlobFromBuffer(
    buildUserScopedPath(userId, `transcripts/${s.id}.json`),
    jsonBuf,
    'application/json',
    { access: 'public' },
  )

  const transcriptTxtUrl = txtBlob.downloadUrl || txtBlob.url
  const transcriptJsonUrl = jsonBlob.downloadUrl || jsonBlob.url

  s.artifacts = {
    ...s.artifacts,
    transcript_txt: transcriptTxtUrl,
    transcript_json: transcriptJsonUrl,
  }
  if (body.sessionAudioUrl) {
    s.artifacts.session_audio = body.sessionAudioUrl
  }
  s.total_turns = turns.length

  const manifestBody = {
    sessionId: s.id,
    created_at: s.created_at,
    email: s.email_to,
    title: s.title,
    totals: { turns: turns.length, durationMs: s.duration_ms },
    turns: turns.map((t) => ({ id: t.id, role: t.role, text: t.text, audio: t.audio || null })),
    artifacts: s.artifacts,
    status: s.status,
  }
  const manifestBlob = await putBlobFromBuffer(
    buildUserScopedPath(userId, `sessions/${s.id}/session-${s.id}.json`),
    Buffer.from(JSON.stringify(manifestBody, null, 2), 'utf8'),
    'application/json',
    { access: 'public' },
  )
  const manifestUrl = manifestBlob.downloadUrl || manifestBlob.url
  s.artifacts.session_manifest = manifestUrl

  rememberSessionManifest(userId, manifestBody, s.id, s.created_at, manifestUrl)

  const date = new Date(s.created_at).toLocaleString()
  const bodyText = [
    `Your interview session (${date})`,
    `Turns: ${s.total_turns}`,
    `Duration: ${Math.round(s.duration_ms / 1000)}s`,
    inlineAwareLabel('Transcript (txt)', s.artifacts.transcript_txt),
    inlineAwareLabel('Transcript (json)', s.artifacts.transcript_json),
    inlineAwareLabel('Session audio', s.artifacts.session_audio),
  ].join('\n')
  let emailStatus:
    | Awaited<ReturnType<typeof sendSummaryEmail>>
    | { ok: false; provider: 'unknown'; error: string }
    | { skipped: true }
  if (!s.email_to || !/.+@.+/.test(s.email_to)) {
    emailStatus = { skipped: true }
  } else {
    try {
      emailStatus = await sendSummaryEmail(s.email_to, `Interview session – ${date}`, bodyText)
    } catch (e: any) {
      emailStatus = { ok: false, provider: 'unknown', error: e?.message || 'send_failed' }
      flagFox({
        id: 'theory-4-email-send-failed',
        theory: 4,
        level: 'error',
        message: 'Failed to send session summary email from finalizeSession.',
        details: { sessionId: s.id, error: e?.message || 'send_failed' },
      })
    }
  }

  if ('ok' in emailStatus && emailStatus.ok) {
    s.status = 'emailed'
  } else if ('skipped' in emailStatus && emailStatus.skipped) {
    s.status = 'completed'
  } else {
    s.status = 'error'
    flagFox({
      id: 'theory-4-email-status-error',
      theory: 4,
      level: 'warn',
      message: 'Session marked as error because summary email failed.',
      details: { sessionId: s.id, emailStatus },
    })
  }

  state.sessions.set(id, s)

  await rebuildMemoryPrimer(userId).catch((err) => {
    console.warn('Failed to rebuild memory primer', err)
  })

  const emailed = !!('ok' in emailStatus && emailStatus.ok)
  return { ok: true, session: s, emailed, emailStatus }
}

export function mergeSessionArtifacts(rawUserId: string, id: string, patch: SessionPatch) {
  const { state } = ensureUserState(rawUserId)
  const session = state.sessions.get(id)
  if (!session) return
  if (patch.artifacts) {
    const filteredEntries = Object.entries(patch.artifacts).filter(
      ([, value]) => typeof value === 'string' && value.length > 0,
    ) as [string, string][]
    if (filteredEntries.length) {
      session.artifacts = { ...(session.artifacts || {}), ...Object.fromEntries(filteredEntries) }
    }
  }
  if (typeof patch.totalTurns === 'number' && Number.isFinite(patch.totalTurns)) {
    session.total_turns = patch.totalTurns
  }
  if (typeof patch.durationMs === 'number' && Number.isFinite(patch.durationMs)) {
    session.duration_ms = patch.durationMs
  }
  if (patch.status) {
    session.status = patch.status
  }
  state.sessions.set(id, session)
}

export async function deleteSession(
  rawUserId: string,
  id: string,
): Promise<{ ok: boolean; deleted: boolean; reason?: string }> {
  if (!id) {
    return { ok: false, deleted: false, reason: 'invalid_id' }
  }

  const { userId, state } = ensureUserState(rawUserId)
  await ensureSessionMemoryHydrated(userId).catch(() => undefined)

  let session = state.sessions.get(id)
  if (!session) {
    session = (await getSession(userId, id)) as RememberedSession | undefined
  }

  const artifactUrls = new Set<string>()
  if (session?.artifacts) {
    for (const value of Object.values(session.artifacts)) {
      if (typeof value === 'string' && value.length) {
        artifactUrls.add(value)
      }
    }
  }

  let removed = !!session

  for (const url of artifactUrls) {
    try {
      const deleted = await deleteBlob(url)
      if (deleted) removed = true
    } catch (err) {
      console.warn('Failed to delete session artifact blob', { id, url, err })
    }
  }

  const prefixes = [
    buildUserScopedPath(userId, `sessions/${id}/`),
    buildUserScopedPath(userId, `transcripts/${id}`),
  ]
  for (const prefix of prefixes) {
    try {
      const count = await deleteBlobsByPrefix(prefix)
      if (count > 0) {
        removed = true
      }
    } catch (err) {
      console.warn('Failed to delete blobs for prefix', { id, prefix, err })
    }
  }

  if (session) {
    state.sessions.delete(session.id)
  } else {
    state.sessions.delete(id)
  }

  if (state.sessions.size > 0) {
    await rebuildMemoryPrimer(userId).catch((err) => {
      console.warn('Failed to rebuild memory primer after deletion', err)
    })
  } else {
    await deleteBlob(buildUserScopedPath(userId, MEMORY_PRIMER_SUFFIX)).catch(() => undefined)
    resetPrimerState(state)
  }

  state.hydrationState.hydrated = true
  state.hydrationState.attempted = true

  return { ok: true, deleted: removed }
}

export async function clearAllSessions(rawUserId: string): Promise<{ ok: boolean }> {
  const { userId, state } = ensureUserState(rawUserId)
  await ensureSessionMemoryHydrated(userId).catch(() => undefined)

  state.sessions.clear()

  const prefixes = [
    buildUserScopedPath(userId, 'sessions/'),
    buildUserScopedPath(userId, 'transcripts/'),
    buildUserScopedPath(userId, 'memory/'),
  ]
  await Promise.all(
    prefixes.map(async (prefix) => {
      try {
        await deleteBlobsByPrefix(prefix)
      } catch (err) {
        console.warn('Failed to delete blobs during clearAllSessions', { prefix, err })
      }
    }),
  )

  await deleteBlob(buildUserScopedPath(userId, MEMORY_PRIMER_SUFFIX)).catch(() => undefined)
  resetPrimerState(state)
  state.hydrationState.attempted = true
  state.hydrationState.hydrated = true

  return { ok: true }
}

export async function listSessions(rawUserId: string): Promise<Session[]> {
  const { userId, state } = ensureUserState(rawUserId)
  await ensureSessionMemoryHydrated(userId).catch(() => undefined)
  const seen = new Map<string, RememberedSession>()
  for (const session of state.sessions.values()) {
    seen.set(session.id, { ...session, turns: session.turns ? [...session.turns] : [] })
  }
  return Array.from(seen.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export type SessionMemorySnapshot = {
  id: string
  created_at: string
  title?: string
  status: Session['status']
  total_turns: number
  turns: { role: Turn['role']; text: string }[]
}

export function getSessionMemorySnapshot(
  rawUserId: string,
  focusSessionId?: string,
): { current?: SessionMemorySnapshot; sessions: SessionMemorySnapshot[] } {
  const { state } = ensureUserState(rawUserId)
  const sessions = Array.from(state.sessions.values())
    .map((session) => ({
      id: session.id,
      created_at: session.created_at,
      title: session.title,
      status: session.status,
      total_turns: session.total_turns,
      turns: (session.turns || []).map((turn) => ({ role: turn.role, text: turn.text })),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  const current = focusSessionId ? sessions.find((session) => session.id === focusSessionId) : undefined

  return { current, sessions }
}


export async function getSession(rawUserId: string, id: string): Promise<Session | undefined> {
  const { userId, state } = ensureUserState(rawUserId)
  const inMemory = state.sessions.get(id)
  if (inMemory) return inMemory

  const manifest = await fetchSessionManifest(userId, state, id)
  if (manifest) {
    const storedId = rememberSessionManifest(
      userId,
      manifest.data,
      manifest.id,
      manifest.uploadedAt,
      manifest.url,
    )
    const stored = storedId ? state.sessions.get(storedId) : state.sessions.get(manifest.id)
    if (stored) return stored
    const derived = buildSessionFromManifest(manifest.data, manifest.id, manifest.uploadedAt)
    if (derived) return derived
  }

  return undefined
}

export function __dangerousResetMemoryState(rawUserId?: string) {
  if (typeof rawUserId === 'string') {
    const { state } = ensureUserState(rawUserId)
    state.sessions.clear()
    state.hydrationState.attempted = false
    state.hydrationState.hydrated = false
    resetPrimerState(state)
    return
  }
  userStates.clear()
}

async function fetchSessionManifest(
  userId: string,
  state: UserMemoryState,
  sessionId: string,
): Promise<ManifestLookup | null> {
  try {
    const prefix = buildUserScopedPath(userId, `sessions/${sessionId}/`)
    const { blobs } = await listBlobs({ prefix, limit: 25 })
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
  rawUserId: string,
  manifest: any,
  fallbackId?: string,
  fallbackCreatedAt?: string,
  manifestUrl?: string,
): string | undefined {
  const { state } = ensureUserState(rawUserId)
  const derived = buildSessionFromManifest(manifest, fallbackId, fallbackCreatedAt)
  if (!derived) return
  if (manifestUrl) {
    derived.artifacts = {
      ...(derived.artifacts || {}),
      session_manifest: manifestUrl,
      manifest: manifestUrl,
    }
  }
  state.sessions.set(derived.id, {
    ...derived,
    turns: derived.turns ? [...derived.turns] : [],
  })
  return derived.id
}

export function buildSessionFromManifest(
  data: any,
  fallbackId?: string,
  fallbackCreatedAt?: string,
): RememberedSession | undefined {
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


  const session: RememberedSession = {
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
