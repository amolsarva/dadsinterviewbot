import { putBlobFromBuffer, listBlobs, deleteBlobsByPrefix, deleteBlob } from './blob'
import { sendSummaryEmail } from './email'
import { flagFox } from './foxes'
import { generateSessionTitle, SummarizableTurn } from './session-title'
import { formatSessionTitleFallback } from './fallback-texts'
import { normalizeHandle } from './user-scope'

export type Session = {
  id: string
  created_at: string
  title?: string
  email_to: string
  user_handle?: string | null
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

const globalKey = '__dads_interview_mem__'
const bootKey = '__dads_interview_mem_boot__'
const primerMapKey = '__dads_interview_memory_primers__'
const hydrationKey = '__dads_interview_mem_hydrated__'
type PrimerState = { text: string; url?: string; updatedAt?: string; loaded: boolean }
const g: any = globalThis as any
if (!g[globalKey]) {
  g[globalKey] = { sessions: new Map<string, RememberedSession>() }
}
if (!g[bootKey]) {
  g[bootKey] = new Date().toISOString()
}
if (!g[primerMapKey]) {
  g[primerMapKey] = new Map<string, PrimerState>()
}
if (!g[hydrationKey]) {
  g[hydrationKey] = { attempted: false, hydrated: false }
}
const mem: { sessions: Map<string, RememberedSession> } = g[globalKey]
const memBootedAt: string = g[bootKey]

const primerStates: Map<string, PrimerState> = g[primerMapKey]
const hydrationState: { attempted: boolean; hydrated: boolean } = g[hydrationKey]

const MEMORY_PRIMER_PREFIX = 'memory/primers'
const LEGACY_MEMORY_PRIMER_PATH = 'memory/MemoryPrimer.txt'

function sessionManifestPath(sessionId: string) {
  return `sessions/${sessionId}/session-${sessionId}.json`
}

function primerKeyForHandle(handle?: string | null) {
  const normalized = normalizeHandle(handle ?? undefined)
  return normalized ?? 'unassigned'
}

function memoryPrimerPathForKey(key: string) {
  return `${MEMORY_PRIMER_PREFIX}/${key}.md`
}

function ensurePrimerState(key: string): PrimerState {
  let state = primerStates.get(key)
  if (!state) {
    state = { text: '', url: undefined, updatedAt: undefined, loaded: false }
    primerStates.set(key, state)
  }
  return state
}

function resetPrimerState(key?: string) {
  if (key) {
    const state = ensurePrimerState(key)
    state.text = ''
    state.url = undefined
    state.updatedAt = undefined
    state.loaded = false
    primerLoadPromises.delete(key)
    return
  }
  for (const primerKey of primerStates.keys()) {
    resetPrimerState(primerKey)
  }
}

let hydrationPromise: Promise<void> | null = null
const primerLoadPromises = new Map<string, Promise<void>>()

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

function truncateSnippet(text: string, limit = 200) {
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

type StageDefinition = {
  id: string
  title: string
  keywords: RegExp[]
  fallback: string
}

type StageBucket = {
  latest: string[]
  archive: string[]
  seen: Set<string>
}

const INTERVIEW_STAGE_DEFINITIONS: StageDefinition[] = [
  {
    id: 'intro',
    title: 'Intro & Warm Memories',
    keywords: [/born/i, /birth/i, /child/i, /parent/i, /sibling/i, /neighbou?r/i, /home/i],
    fallback: 'Capture birthplace, early home life, and the people who raised them.',
  },
  {
    id: 'youth',
    title: 'Youth & Formative Years',
    keywords: [/school/i, /class/i, /teacher/i, /friend/i, /teen/i, /dream/i, /mentor/i],
    fallback: 'Ask about schooling, friendships, and the dreams they held while growing up.',
  },
  {
    id: 'young-adult',
    title: 'Young Adulthood & Transitions',
    keywords: [/college/i, /university/i, /moved/i, /travel/i, /married/i, /spouse/i, /partner/i, /job/i, /courtship/i],
    fallback: 'Explore their first leaps into adulthood—moves, work, relationships, or world events that shaped them.',
  },
  {
    id: 'work-family',
    title: 'Work, Family & Midlife',
    keywords: [/career/i, /work/i, /business/i, /child/i, /parent/i, /tradition/i, /family/i, /household/i],
    fallback: 'Document career turns, family roles, and traditions they kept or changed.',
  },
  {
    id: 'later-years',
    title: 'Later Years & Reflection',
    keywords: [/retir/i, /proud/i, /regret/i, /lesson/i, /value/i, /resilience/i, /reflect/i],
    fallback: 'Invite reflections on what matters most now—pride, regrets, and lessons they want remembered.',
  },
  {
    id: 'memory-place',
    title: 'Memory, Place & Sense of Self',
    keywords: [/place/i, /smell/i, /sound/i, /object/i, /photo/i, /scene/i, /moment/i, /remember/i],
    fallback: 'Gather vivid sensory scenes—places, objects, and moments that keep their story alive.',
  },
  {
    id: 'culture-change',
    title: 'Culture, Change & The World',
    keywords: [/culture/i, /tradition/i, /world/i, /technology/i, /community/i, /change/i, /society/i, /language/i],
    fallback: 'Trace how the world shifted around them and which cultural threads they held onto.',
  },
  {
    id: 'legacy',
    title: 'Closing & Legacy',
    keywords: [/legacy/i, /remember/i, /advice/i, /hope/i, /message/i, /future/i],
    fallback: 'Capture the legacy or advice they want the next generation to hold close.',
  },
]

const OTHER_STAGE_DEFINITION: StageDefinition = {
  id: 'other',
  title: 'Additional Notes & Identity',
  keywords: [],
  fallback: 'Notice any defining details that do not yet fit the guide—values, humour, or standout personality cues.',
}

const MAX_LATEST_DETAILS_PER_STAGE = 4
const MAX_ARCHIVE_DETAILS_PER_STAGE = 6

function normalizeDetailSnippet(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return capitalized
}

function extractSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12)
}

function categorizeDetail(detail: string): StageDefinition {
  for (const stage of INTERVIEW_STAGE_DEFINITIONS) {
    if (stage.keywords.some((keyword) => keyword.test(detail))) {
      return stage
    }
  }
  return OTHER_STAGE_DEFINITION
}

function ensureStageBucket(map: Map<string, StageBucket>, id: string): StageBucket {
  let bucket = map.get(id)
  if (!bucket) {
    bucket = { latest: [], archive: [], seen: new Set<string>() }
    map.set(id, bucket)
  }
  return bucket
}

function registerDetail(
  buckets: Map<string, StageBucket>,
  stageId: string,
  detail: string,
  options: { latest: boolean },
) {
  const bucket = ensureStageBucket(buckets, stageId)
  if (bucket.seen.has(detail)) return
  bucket.seen.add(detail)
  if (options.latest) {
    if (bucket.latest.length >= MAX_LATEST_DETAILS_PER_STAGE) return
    bucket.latest.push(detail)
  } else {
    if (bucket.archive.length >= MAX_ARCHIVE_DETAILS_PER_STAGE) return
    bucket.archive.push(detail)
  }
}

function collectStageInsights(
  sessions: RememberedSession[],
  latestSessionId: string | undefined,
): Map<string, StageBucket> {
  const buckets = new Map<string, StageBucket>()
  for (const session of sessions) {
    const isLatest = session.id === latestSessionId
    const turns = (session.turns || []).filter((turn) => turn.role === 'user' && turn.text && turn.text.trim().length)
    for (const turn of turns) {
      const sentences = extractSentences(turn.text)
      for (const sentence of sentences) {
        const snippet = truncateSnippet(sentence)
        if (!snippet) continue
        const normalized = normalizeDetailSnippet(snippet)
        if (!normalized) continue
        const stage = categorizeDetail(normalized)
        registerDetail(buckets, stage.id, normalized, { latest: isLatest })
      }
    }
  }
  return buckets
}

async function ensurePrimerLoadedFromStorage(handle?: string | null) {
  const key = primerKeyForHandle(handle)
  const state = ensurePrimerState(key)
  if (state.loaded && state.text) return
  if (primerLoadPromises.has(key)) {
    await primerLoadPromises.get(key)
    return
  }
  const loadPromise = (async () => {
    try {
      const primerPath = memoryPrimerPathForKey(key)
      const { blobs } = await listBlobs({ prefix: primerPath, limit: 1 })
      let primerBlob = blobs.find((blob) => blob.pathname === primerPath)
      if (!primerBlob && key === 'unassigned') {
        const legacy = await listBlobs({ prefix: LEGACY_MEMORY_PRIMER_PATH, limit: 1 })
        primerBlob = legacy.blobs.find((blob) => blob.pathname === LEGACY_MEMORY_PRIMER_PATH)
      }
      if (!primerBlob) return
      const url = primerBlob.downloadUrl || primerBlob.url
      const resp = await fetch(url)
      if (!resp.ok) return
      const text = await resp.text()
      state.text = text
      state.url = url
      state.updatedAt = safeDateString(
        primerBlob.uploadedAt instanceof Date
          ? primerBlob.uploadedAt.toISOString()
          : typeof primerBlob.uploadedAt === 'string'
          ? primerBlob.uploadedAt
          : undefined,
      )
    } catch (err) {
      console.warn(
        'Failed to load memory primer from storage',
        err,
        err && typeof err === 'object' ? (err as any).blobDetails : undefined,
      )
    } finally {
      state.loaded = true
    }
  })()
  primerLoadPromises.set(key, loadPromise)
  try {
    await loadPromise
  } finally {
    primerLoadPromises.delete(key)
  }
}

async function hydrateSessionsFromBlobs() {
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
        if (storedId) continue
        if (fallbackId && mem.sessions.has(fallbackId)) continue
        const derived = buildSessionFromManifest(data, fallbackId, uploadedAt)
        if (derived) {
          mem.sessions.set(derived.id, { ...derived, turns: derived.turns ? [...derived.turns] : [] })
        }
      } catch (err) {
        console.warn(
          'Failed to parse session manifest',
          err,
          err && typeof err === 'object' ? (err as any).blobDetails : undefined,
        )
      }
    }
    hydrationState.hydrated = true
  } catch (err) {
    console.warn(
      'Failed to list session manifests',
      err,
      err && typeof err === 'object' ? (err as any).blobDetails : undefined,
    )
  } finally {
    hydrationState.attempted = true
  }
}

export async function ensureSessionMemoryHydrated() {
  if (hydrationState.hydrated) return
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      await hydrateSessionsFromBlobs()
    })()
  }
  try {
    await hydrationPromise
  } finally {
    hydrationPromise = null
  }
}

export async function getMemoryPrimer(
  handle?: string | null,
): Promise<{ text: string; url?: string; updatedAt?: string }> {
  const key = primerKeyForHandle(handle)
  const state = ensurePrimerState(key)
  if (!state.loaded || !state.text) {
    await ensurePrimerLoadedFromStorage(handle)
  }
  if (!state.text) {
    const sessionsWithContent = Array.from(mem.sessions.values()).filter((session) => {
      if (primerKeyForHandle(session.user_handle ?? null) !== key) return false
      return (session.turns || []).some((turn) => typeof turn.text === 'string' && turn.text.trim().length)
    })
    if (sessionsWithContent.length) {
      await rebuildMemoryPrimer(handle)
    } else {
      const fallbackPrimer = buildMemoryPrimerFromSessions(handle ?? null, [])
      state.text = fallbackPrimer
      state.loaded = true
    }
  }
  return { text: state.text, url: state.url, updatedAt: state.updatedAt }
}

function buildMemoryPrimerFromSessions(
  handle: string | null,
  sessions: RememberedSession[],
): string {
  const normalizedHandle = normalizeHandle(handle ?? undefined)
  const displayHandle = normalizedHandle ? `@${normalizedHandle}` : 'Unassigned storyteller'
  const sorted = [...sessions].sort((a, b) => (a.created_at > b.created_at ? 1 : -1))
  const latest = sorted.length ? sorted[sorted.length - 1] : undefined
  const latestSessionId = latest?.id
  const stageBuckets = collectStageInsights(sorted, latestSessionId)

  const lines: string[] = []
  lines.push(`# Memory Primer — ${displayHandle}`)
  lines.push(`Updated: ${formatDateTime(new Date().toISOString())}`)
  lines.push('')
  lines.push(
    'Use this biography snapshot before the next interview session. It follows the Interview Guide stages and keeps the newest details marked.',
  )
  lines.push('Reference the guide at docs/interview-guide.md for deeper prompts.')
  lines.push('')
  lines.push(`Total recorded sessions: ${sorted.length}`)
  const latestLabel = latest
    ? latest.title || `Session from ${formatDateTime(latest.created_at)}`
    : 'None yet'
  lines.push(`Latest session captured: ${latestLabel}`)
  if (latest?.created_at) {
    lines.push(`Last session timestamp: ${formatDateTime(latest.created_at)}`)
  }
  lines.push('')

  const latestHighlights: string[] = []
  for (const stage of [...INTERVIEW_STAGE_DEFINITIONS, OTHER_STAGE_DEFINITION]) {
    const bucket = stageBuckets.get(stage.id)
    if (!bucket) continue
    for (const detail of bucket.latest) {
      latestHighlights.push(`${stage.title}: ${detail}`)
      if (latestHighlights.length >= 6) break
    }
    if (latestHighlights.length >= 6) break
  }
  if (latestHighlights.length) {
    lines.push('## Latest Session Highlights')
    for (const highlight of latestHighlights) {
      lines.push(`- ${highlight}`)
    }
    lines.push('')
  }

  lines.push('## Interview Guide Map')
  lines.push('')

  const missingStages: string[] = []
  for (const stage of INTERVIEW_STAGE_DEFINITIONS) {
    const bucket = stageBuckets.get(stage.id)
    lines.push(`### ${stage.title}`)
    if (bucket && (bucket.latest.length || bucket.archive.length)) {
      for (const detail of bucket.latest) {
        lines.push(`- Latest • ${detail}`)
      }
      for (const detail of bucket.archive) {
        lines.push(`- ${detail}`)
      }
    } else {
      missingStages.push(stage.title)
      lines.push(`- ${stage.fallback}`)
    }
    lines.push('')
  }

  const otherBucket = stageBuckets.get(OTHER_STAGE_DEFINITION.id)
  lines.push(`### ${OTHER_STAGE_DEFINITION.title}`)
  if (otherBucket && (otherBucket.latest.length || otherBucket.archive.length)) {
    for (const detail of otherBucket.latest) {
      lines.push(`- Latest • ${detail}`)
    }
    for (const detail of otherBucket.archive) {
      lines.push(`- ${detail}`)
    }
  } else {
    lines.push(`- ${OTHER_STAGE_DEFINITION.fallback}`)
  }
  lines.push('')

  if (missingStages.length) {
    lines.push('## Suggested Next Angles')
    for (const stageTitle of missingStages) {
      lines.push(`- Revisit the ${stageTitle} section of the guide for fresh prompts.`)
    }
    lines.push('')
  }

  if (!sorted.length) {
    lines.push('No conversations have been recorded yet. Use the guide to plan the first session.')
  }

  return lines.join('\n').trim()
}

export async function rebuildMemoryPrimer(
  handle?: string | null,
): Promise<{ text: string; url?: string; updatedAt?: string }> {
  const key = primerKeyForHandle(handle)
  const state = ensurePrimerState(key)
  const sessions = Array.from(mem.sessions.values()).filter(
    (session) => primerKeyForHandle(session.user_handle ?? null) === key,
  )
  const primerText = buildMemoryPrimerFromSessions(handle ?? null, sessions)
  const blob = await putBlobFromBuffer(
    memoryPrimerPathForKey(key),
    Buffer.from(primerText, 'utf8'),
    'text/markdown; charset=utf-8',
    { access: 'public' },
  )
  state.text = primerText
  state.url = blob.downloadUrl || blob.url
  state.updatedAt = new Date().toISOString()
  state.loaded = true
  if (key === 'unassigned') {
    await deleteBlob(LEGACY_MEMORY_PRIMER_PATH).catch(() => undefined)
  }
  return { text: primerText, url: state.url, updatedAt: state.updatedAt }
}

export async function dbHealth() {
  return { ok: true, mode: 'memory' }
}

export async function createSession({
  email_to,
  user_handle,
}: {
  email_to: string
  user_handle?: string | null
}): Promise<Session> {
  await ensureSessionMemoryHydrated().catch(() => undefined)
  const normalizedHandle = normalizeHandle(user_handle ?? undefined) ?? null
  await getMemoryPrimer(normalizedHandle).catch(() => undefined)
  const s: RememberedSession = {
    id: uid(),
    created_at: new Date().toISOString(),
    email_to,
    user_handle: normalizedHandle,
    status: 'in_progress',
    duration_ms: 0,
    total_turns: 0,
    turns: [],
    artifacts: {},
  }
  mem.sessions.set(s.id, s)
  if (mem.sessions.size === 1) {
    flagFox({
      id: 'theory-1-memory-warmed',
      theory: 1,
      level: 'info',
      message: 'In-memory session store warmed with first session.',
      details: { bootedAt: memBootedAt, sessionId: s.id },
    })
  }
  try {
    await persistSessionSnapshot(s)
  } catch (err) {
    console.warn('Failed to persist initial session manifest', err, (err as any)?.blobDetails)
  }
  return s
}

function buildSessionManifestPayload(session: RememberedSession) {
  const turns = (session.turns || []).map((turn, index) => {
    const base: Record<string, any> = {
      id: turn.id,
      role: turn.role,
      text: turn.text,
      turn: index + 1,
    }
    if (turn.role === 'user') {
      base.transcript = turn.text
    } else {
      base.assistantReply = turn.text
    }
    if (typeof turn.audio_blob_url === 'string' && turn.audio_blob_url.length) {
      base.audio = turn.audio_blob_url
      base.audioUrl = turn.audio_blob_url
      base.userAudioUrl = turn.audio_blob_url
    }
    return base
  })

  return {
    sessionId: session.id,
    created_at: session.created_at,
    startedAt: session.created_at,
    email: session.email_to,
    user_handle: session.user_handle ?? null,
    userHandle: session.user_handle ?? null,
    title: session.title,
    status: session.status,
    totals: {
      turns: turns.length,
      durationMs: session.duration_ms,
    },
    artifacts: session.artifacts ?? {},
    turns,
  }
}

async function persistSessionSnapshot(session: RememberedSession) {
  try {
    const manifest = buildSessionManifestPayload(session)
    const blob = await putBlobFromBuffer(
      sessionManifestPath(session.id),
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      'application/json',
      { access: 'public' },
    )
    const manifestUrl = blob.downloadUrl || blob.url
    if (manifestUrl) {
      session.artifacts = {
        ...(session.artifacts || {}),
        session_manifest: manifestUrl,
        manifest: manifestUrl,
      }
    }
  } catch (err) {
    console.warn(
      'Failed to persist session snapshot',
      err,
      err && typeof err === 'object' ? (err as any).blobDetails : undefined,
    )
  }
}

export async function appendTurn(id: string, turn: Partial<Turn>) {
  let s = mem.sessions.get(id)
  if (!s) {
    await ensureSessionMemoryHydrated().catch(() => undefined)
    s = mem.sessions.get(id)
  }

  if (!s) {
    const restored = (await getSession(id)) as RememberedSession | undefined
    if (restored) {
      const hydrated = mem.sessions.get(restored.id)
      if (hydrated) {
        s = hydrated
      } else {
        const clone: RememberedSession = {
          ...restored,
          turns: restored.turns ? [...restored.turns] : [],
        }
        mem.sessions.set(clone.id, clone)
        s = clone
      }
    }
  }

  if (!s) {
    flagFox({
      id: 'theory-1-memory-miss',
      theory: 1,
      level: 'warn',
      message: 'Attempted to append a turn but the in-memory session was missing.',
      details: { sessionId: id, bootedAt: memBootedAt, storedSessions: mem.sessions.size },
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
  await persistSessionSnapshot(s)
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
  id: string,
  body: { clientDurationMs: number; sessionAudioUrl?: string | null },
): Promise<FinalizeSessionResult> {
  await ensureSessionMemoryHydrated().catch(() => undefined)
  const s = mem.sessions.get(id)
  if (!s) {
    flagFox({
      id: 'theory-1-finalize-memory-miss',
      theory: 1,
      level: 'error',
      message: 'Finalization attempted after session disappeared from memory.',
      details: { sessionId: id, bootedAt: memBootedAt, storedSessions: mem.sessions.size },
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
    fallback: formatSessionTitleFallback(s.created_at),
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

  const txtBlob = await putBlobFromBuffer(`transcripts/${s.id}.txt`, txtBuf, 'text/plain; charset=utf-8', {
    access: 'public',
  })
  const jsonBlob = await putBlobFromBuffer(`transcripts/${s.id}.json`, jsonBuf, 'application/json', { access: 'public' })

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

  await persistSessionSnapshot(s)

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

  mem.sessions.set(id, s)

  await rebuildMemoryPrimer(s.user_handle ?? null).catch((err) => {
    console.warn('Failed to rebuild memory primer', err, (err as any)?.blobDetails)
  })

  const emailed = !!('ok' in emailStatus && emailStatus.ok)
  return { ok: true, session: s, emailed, emailStatus }
}

export function mergeSessionArtifacts(id: string, patch: SessionPatch) {
  const session = mem.sessions.get(id)
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
  mem.sessions.set(id, session)
}

export async function deleteSession(
  id: string,
): Promise<{ ok: boolean; deleted: boolean; reason?: string }> {
  if (!id) {
    return { ok: false, deleted: false, reason: 'invalid_id' }
  }

  await ensureSessionMemoryHydrated().catch(() => undefined)

  let session = mem.sessions.get(id)
  if (!session) {
    session = (await getSession(id)) as RememberedSession | undefined
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
      console.warn('Failed to delete session artifact blob', {
        id,
        url,
        err,
        blobDetails: err && typeof err === 'object' ? (err as any).blobDetails : undefined,
      })
    }
  }

  const prefixes = [`sessions/${id}/`, `transcripts/${id}`]
  for (const prefix of prefixes) {
    try {
      const count = await deleteBlobsByPrefix(prefix)
      if (count > 0) {
        removed = true
      }
    } catch (err) {
      console.warn('Failed to delete blobs for prefix', {
        id,
        prefix,
        err,
        blobDetails: err && typeof err === 'object' ? (err as any).blobDetails : undefined,
      })
    }
  }

  const deletedHandle = session?.user_handle ?? null
  const deletedHandleKey = primerKeyForHandle(deletedHandle)

  if (session) {
    mem.sessions.delete(session.id)
  } else {
    mem.sessions.delete(id)
  }

  if (session) {
    const hasRemainingForHandle = Array.from(mem.sessions.values()).some(
      (stored) => primerKeyForHandle(stored.user_handle ?? null) === deletedHandleKey,
    )
    if (hasRemainingForHandle) {
      await rebuildMemoryPrimer(deletedHandle).catch((err) => {
        console.warn('Failed to rebuild memory primer after deletion', err, (err as any)?.blobDetails)
      })
    } else {
      await deleteBlob(memoryPrimerPathForKey(deletedHandleKey)).catch(() => undefined)
      if (deletedHandleKey === 'unassigned') {
        await deleteBlob(LEGACY_MEMORY_PRIMER_PATH).catch(() => undefined)
      }
      resetPrimerState(deletedHandleKey)
    }
  } else if (mem.sessions.size === 0) {
    await deleteBlob(LEGACY_MEMORY_PRIMER_PATH).catch(() => undefined)
    await deleteBlob(memoryPrimerPathForKey('unassigned')).catch(() => undefined)
    resetPrimerState()
  }

  hydrationState.hydrated = true
  hydrationState.attempted = true

  return { ok: true, deleted: removed }
}

export async function clearAllSessions(): Promise<{ ok: boolean }> {
  await ensureSessionMemoryHydrated().catch(() => undefined)

  mem.sessions.clear()

  const prefixes = ['sessions/', 'transcripts/', `${MEMORY_PRIMER_PREFIX}/`]
  await Promise.all(
    prefixes.map(async (prefix) => {
      try {
        await deleteBlobsByPrefix(prefix)
      } catch (err) {
        console.warn('Failed to delete blobs during clearAllSessions', {
          prefix,
          err,
          blobDetails: err && typeof err === 'object' ? (err as any).blobDetails : undefined,
        })
      }
    }),
  )

  await deleteBlob(LEGACY_MEMORY_PRIMER_PATH).catch(() => undefined)
  resetPrimerState()
  hydrationState.attempted = true
  hydrationState.hydrated = true

  return { ok: true }
}

export async function deleteSessionsByHandle(
  handle?: string | null,
): Promise<{ ok: boolean; deleted: number }> {
  await ensureSessionMemoryHydrated().catch(() => undefined)
  const normalizedHandle = normalizeHandle(handle ?? undefined)
  const idsToDelete: string[] = []
  for (const session of mem.sessions.values()) {
    const sessionHandle = normalizeHandle(session.user_handle ?? undefined)
    if (normalizedHandle) {
      if (sessionHandle === normalizedHandle) {
        idsToDelete.push(session.id)
      }
    } else if (!sessionHandle) {
      idsToDelete.push(session.id)
    }
  }

  let deleted = 0
  for (const id of idsToDelete) {
    try {
      const result = await deleteSession(id)
      if (result.deleted) deleted += 1
    } catch {
      // ignore errors so one bad session doesn't block others
    }
  }

  return { ok: true, deleted }
}

export async function listSessions(handle?: string | null): Promise<Session[]> {
  await ensureSessionMemoryHydrated().catch(() => undefined)
  const normalizedHandle = normalizeHandle(handle ?? undefined)
  const seen = new Map<string, RememberedSession>()
  for (const session of mem.sessions.values()) {
    const sessionHandle = normalizeHandle(session.user_handle ?? undefined)
    if (normalizedHandle) {
      if (sessionHandle !== normalizedHandle) continue
    } else if (sessionHandle) {
      continue
    }
    seen.set(session.id, { ...session, turns: session.turns ? [...session.turns] : [] })
  }
  return Array.from(seen.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export async function listUserHandles(options: { limit?: number } = {}): Promise<string[]> {
  await ensureSessionMemoryHydrated().catch(() => undefined)
  const limitParam = Number.isFinite(options.limit ?? NaN) ? Number(options.limit) : NaN
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 24) : 12

  const latestByHandle = new Map<string, string>()
  for (const session of mem.sessions.values()) {
    const normalized = normalizeHandle(session.user_handle ?? undefined)
    if (!normalized) continue
    const createdAt = typeof session.created_at === 'string' ? session.created_at : ''
    const existing = latestByHandle.get(normalized)
    if (!existing || (createdAt && createdAt > existing)) {
      latestByHandle.set(normalized, createdAt || existing || '')
    }
  }

  if (!latestByHandle.size) {
    return []
  }

  const sorted = Array.from(latestByHandle.entries()).sort((a, b) => {
    const aTime = a[1]
    const bTime = b[1]
    if (!aTime && !bTime) return a[0].localeCompare(b[0])
    if (!aTime) return 1
    if (!bTime) return -1
    if (aTime === bTime) return a[0].localeCompare(b[0])
    return aTime < bTime ? 1 : -1
  })

  return sorted.slice(0, limit).map(([handle]) => handle)
}

export type SessionMemorySnapshot = {
  id: string
  created_at: string
  title?: string
  status: Session['status']
  total_turns: number
  user_handle?: string | null
  turns: { role: Turn['role']; text: string }[]
}

export function getSessionMemorySnapshot(
  focusSessionId?: string,
  options: { handle?: string | null } = {},
): { current?: SessionMemorySnapshot; sessions: SessionMemorySnapshot[] } {
  const requestedHandle = normalizeHandle(options.handle ?? undefined)

  const snapshots = Array.from(mem.sessions.values())
    .map((session) => ({
      id: session.id,
      created_at: session.created_at,
      title: session.title,
      status: session.status,
      total_turns: session.total_turns,
      user_handle: session.user_handle ?? null,
      turns: (session.turns || []).map((turn) => ({ role: turn.role, text: turn.text })),
      normalized_handle: normalizeHandle(session.user_handle ?? undefined),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  let focusHandle = requestedHandle
  if (!focusHandle && focusSessionId) {
    const focusSession = snapshots.find((session) => session.id === focusSessionId)
    if (focusSession) {
      focusHandle = focusSession.normalized_handle
    }
  }

  const filtered = snapshots.filter((session) => {
    if (focusHandle) {
      return session.normalized_handle === focusHandle
    }
    return !session.normalized_handle
  })

  const currentRaw = focusSessionId ? filtered.find((session) => session.id === focusSessionId) : undefined
  const sessions = filtered.map(({ normalized_handle, ...rest }) => rest as SessionMemorySnapshot)
  const current = currentRaw
    ? (({ normalized_handle, ...rest }) => rest as SessionMemorySnapshot)(currentRaw)
    : undefined

  return { current, sessions }
}


export async function getSession(id: string): Promise<Session | undefined> {
  const inMemory = mem.sessions.get(id)
  if (inMemory) return inMemory

  const manifest = await fetchSessionManifest(id)
  if (manifest) {
    const storedId = rememberSessionManifest(manifest.data, manifest.id, manifest.uploadedAt, manifest.url)
    const stored = storedId ? mem.sessions.get(storedId) : mem.sessions.get(manifest.id)
    if (stored) return stored
    const derived = buildSessionFromManifest(manifest.data, manifest.id, manifest.uploadedAt)
    if (derived) return derived
  }

  return undefined
}

export function __dangerousResetMemoryState() {
  mem.sessions.clear()
  hydrationState.attempted = false
  hydrationState.hydrated = false
  primerStates.clear()
  primerLoadPromises.clear()
}

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
    console.warn('Failed to fetch session manifest', err, (err as any)?.blobDetails)
    return null
  }
}

export function rememberSessionManifest(
  manifest: any,
  fallbackId?: string,
  fallbackCreatedAt?: string,
  manifestUrl?: string,
): string | undefined {
  const derived = buildSessionFromManifest(manifest, fallbackId, fallbackCreatedAt)
  if (!derived) return
  if (manifestUrl) {
    derived.artifacts = {
      ...(derived.artifacts || {}),
      session_manifest: manifestUrl,
      manifest: manifestUrl,
    }
  }
  mem.sessions.set(derived.id, {
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
  let fallbackTurn = 0
  for (const entry of turnEntries) {
    if (!entry || typeof entry !== 'object') continue
    const rawTurnNumber = Number((entry as any).turn)
    let turnNumber = Number.isFinite(rawTurnNumber) && rawTurnNumber > 0 ? rawTurnNumber : NaN
    if (!Number.isFinite(turnNumber)) {
      fallbackTurn += 1
      turnNumber = fallbackTurn
    }
    if (turnNumber > highestTurnNumber) highestTurnNumber = turnNumber

    const entryId = typeof (entry as any).id === 'string' ? (entry as any).id : undefined
    const roleRaw =
      typeof (entry as any).role === 'string' ? ((entry as any).role as string).toLowerCase() : ''
    const audioCandidate = (() => {
      const candidates = [
        (entry as any).audio,
        (entry as any).audioUrl,
        (entry as any).userAudioUrl,
      ]
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length) {
          return candidate as string
        }
      }
      return undefined
    })()

    const transcriptCandidate = (() => {
      if (roleRaw === 'assistant') return ''
      const candidates = [
        (entry as any).transcript,
        (entry as any).text,
        (entry as any).user?.text,
      ]
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length) {
          return candidate as string
        }
      }
      return ''
    })()

    if (transcriptCandidate) {
      const userId = entryId && roleRaw !== 'assistant' ? entryId : `user-${turnNumber}-${turns.length}`
      turns.push({
        id: userId,
        role: 'user',
        text: transcriptCandidate,
        audio_blob_url: audioCandidate,
      })
    }

    const assistantReply = extractAssistantReply(entry)
    if (assistantReply) {
      const assistantId =
        entryId && roleRaw === 'assistant' ? entryId : `assistant-${turnNumber}-${turns.length}`
      turns.push({ id: assistantId, role: 'assistant', text: assistantReply })
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
    user_handle:
      normalizeHandle(
        typeof data.user_handle === 'string'
          ? data.user_handle
          : typeof data.userHandle === 'string'
          ? data.userHandle
          : undefined,
      ) ?? null,
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
  const roleRaw = typeof entry.role === 'string' ? (entry.role as string).toLowerCase() : ''
  const candidates = [
    entry.assistantReply,
    entry.reply,
    entry.assistant?.reply,
    entry.assistant?.text,
    roleRaw === 'assistant' ? entry.text : undefined,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length) return value
  }
  return ''
}
