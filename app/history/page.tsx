import { HistoryPageContent } from './history-page-content'
import { normalizeUserId } from '@/lib/users'

type HistoryPageProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function HistoryPage({ searchParams }: HistoryPageProps) {
  const rawUser = searchParams?.user
  const userParam = Array.isArray(rawUser) ? rawUser[0] : rawUser
  return <HistoryPageContent userId={normalizeUserId(userParam ?? 'default')} />
}
