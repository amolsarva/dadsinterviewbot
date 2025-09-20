import type { SessionMemorySnapshot } from './data'

const FALLBACK_QUESTION_POOL = [
  'What tiny detail from that moment still feels sharp to you?',
  'Who else was nearby, and what do you remember about them?',
  'What sounds or scents come back when you picture it?',
  'What happened just before that scene unfolded?',
  'How did you feel right after it happened?',
  'Is there an object or keepsake that still reminds you of it?',
  'What was the weather or light like around you?',
  'What music or voices were in the background?',
  'What did you eat or drink around that time?',
  'What colors or textures stand out when you think about it?',
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

function compressDetail(detail: string): string {
  const words = detail.split(/\s+/).filter(Boolean)
  if (words.length <= 14) return detail
  return words.slice(0, 14).join(' ') + '...'
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
