import { HistoryPageContent } from '../../../history/page'
import { normalizeUserId } from '@/lib/users'

type UserHistoryPageProps = {
  params: { user: string }
}

export default function UserHistoryPage({ params }: UserHistoryPageProps) {
  const raw = params?.user ?? 'default'
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  return <HistoryPageContent userId={normalizeUserId(decoded)} />
}
