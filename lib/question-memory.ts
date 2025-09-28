import type { SessionMemorySnapshot } from './data'
import { normalizeHandle } from './user-scope'

const FALLBACK_QUESTION_POOL = [
  'Could you set the scene for me—where were you when this memory took place?',
  'Who else shared that moment with you, and what were they doing?',
  'What was the very first thing you noticed as it unfolded?',
  'What feeling rushed in right away?',
  'Is there a small sound or scent that still brings it back to you?',
  'Was there an object in the room that now holds extra meaning for you?',
  'What was happening just a few moments before everything began?',
  'How did the light or weather color that scene for you?',
  'What voices or music drifted through the background?',
  'Was there a taste or texture that anchors the memory for you?',
]

export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9?\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractAskedQuestions(text: string): string[] {
  if (!text || !text.length) return []
  const matches = text.match(/[^?]*\?/g)
  if (!matches) return []
  return matches.map((question) => question.trim()).filter(Boolean)
}

export function collectAskedQuestions(sessions: SessionMemorySnapshot[]): string[] {
  const questions: string[] = []
  for (const session of sessions) {
    for (const turn of session.turns) {
      if (turn.role !== 'assistant' || !turn.text) continue
      questions.push(...extractAskedQuestions(turn.text))
    }
  }
  return questions
}

export function findLatestUserDetails(
  sessions: SessionMemorySnapshot[],
  options: { excludeSessionId?: string; limit?: number } = {},
): string[] {
  const details: string[] = []
  const { excludeSessionId, limit = 2 } = options
  for (const session of sessions) {
    if (excludeSessionId && session.id === excludeSessionId) continue
    for (let index = session.turns.length - 1; index >= 0; index -= 1) {
      const turn = session.turns[index]
      if (turn.role === 'user' && turn.text && turn.text.trim().length) {
        details.push(turn.text.trim())
        break
      }
    }
    if (details.length >= limit) break
  }
  return details.slice(0, limit)
}

export function sessionHasUserDetail(session: SessionMemorySnapshot): boolean {
  return session.turns.some((turn) => turn.role === 'user' && turn.text && turn.text.trim().length > 0)
}

function defaultSessionLabel(session: SessionMemorySnapshot): string {
  if (session.title && session.title.trim().length) {
    return session.title.trim()
  }
  const stamp = new Date(session.created_at)
  if (!Number.isNaN(stamp.getTime())) {
    return `Session on ${stamp.toLocaleDateString('en-US')}`
  }
  return 'Earlier session'
}

export function compressDetail(detail: string): string {
  const words = detail.split(/\s+/).filter(Boolean)
  if (words.length <= 14) return detail
  return words.slice(0, 14).join(' ') + '...'
}

export function buildMemoryPrimerPreview(
  sessions: SessionMemorySnapshot[],
  options: { limit?: number; heading?: string } = {},
): string {
  const { limit = 4, heading = "Highlights I'm already holding onto for this storyteller:" } = options
  const withDetails = sessions.filter(sessionHasUserDetail)
  if (!withDetails.length) return ''

  const lines: string[] = [heading]
  for (const session of withDetails.slice(0, limit)) {
    const detail = findLatestUserDetails([session], { limit: 1 })[0]
    if (detail) {
      lines.push(`- ${compressDetail(detail)}`)
    } else {
      lines.push(`- ${defaultSessionLabel(session)}`)
    }
  }

  return lines.join('\n')
}

export function pickFallbackQuestion(asked: Iterable<string>, detail?: string): string {
  const normalized = new Set<string>()
  for (const question of asked) {
    if (!question) continue
    normalized.add(normalizeQuestion(question))
  }

  if (detail) {
    const detailQuestion = `When you think about ${compressDetail(detail)}, what else stands out now?`
    if (!normalized.has(normalizeQuestion(detailQuestion))) {
      return detailQuestion
    }
  }

  for (const candidate of FALLBACK_QUESTION_POOL) {
    if (!normalized.has(normalizeQuestion(candidate))) {
      return candidate
    }
  }

  return 'Tell me one detail you have not shared with me yet.'
}

export function buildMemoryLogDocument(options: {
  handle?: string | null
  sessionId?: string | null
  sessions: SessionMemorySnapshot[]
  current?: SessionMemorySnapshot
  hasPriorSessions: boolean
  hasCurrentConversation: boolean
  highlightDetail?: string | null
  historyText?: string
  questionText?: string
  primerText?: string
  askedQuestions?: string[]
}): string {
  const {
    handle,
    sessionId,
    sessions,
    current,
    hasPriorSessions,
    hasCurrentConversation,
    highlightDetail,
    historyText,
    questionText,
    primerText,
    askedQuestions = [],
  } = options

  const normalizedHandle = normalizeHandle(handle ?? undefined)
  const handleLabel = normalizedHandle ? `/u/${normalizedHandle}` : 'guest'
  const lines: string[] = []

  lines.push(`# MemoryLog for ${handleLabel}`)
  lines.push(`Sessions in scope: ${sessions.length}`)
  lines.push(`Focus session: ${sessionId || 'none'}`)
  lines.push(`Current session captured turns: ${current?.turns?.length ?? 0}`)
  lines.push(`Has current conversation: ${hasCurrentConversation ? 'yes' : 'no'}`)
  lines.push(`Has prior detailed sessions: ${hasPriorSessions ? 'yes' : 'no'}`)
  lines.push(`Highlight detail: ${highlightDetail ? compressDetail(highlightDetail) : 'none available'}`)
  if (askedQuestions.length) {
    lines.push(`Asked questions tracked: ${askedQuestions.length}`)
  } else {
    lines.push('Asked questions tracked: 0')
  }

  const historyBlock = historyText?.trim()
  if (historyBlock) {
    lines.push('', 'History summary:', historyBlock)
  }

  const questionBlock = questionText?.trim()
  if (questionBlock) {
    lines.push('', 'Avoid repeating:', questionBlock)
  }

  const recentTurns: string[] = []
  if (current?.turns?.length) {
    recentTurns.push('Recent turns:')
    for (const turn of current.turns.slice(-6)) {
      const prefix = turn.role === 'assistant' ? 'assistant' : 'user'
      recentTurns.push(`- ${prefix}: ${compressDetail(turn.text)}`)
    }
  }
  if (recentTurns.length) {
    lines.push('', ...recentTurns)
  }

  const primerBlock = primerText?.trim()
  if (primerBlock) {
    lines.push('', 'Primer preview:', primerBlock)
  }

  return lines.join('\n').trim()
}
