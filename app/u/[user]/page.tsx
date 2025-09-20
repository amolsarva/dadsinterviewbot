import UserHomePage from '@/app/user-home'
import { normalizeUserId } from '@/lib/users'

type UserPageProps = {
  params: { user: string }
}

export default function UserPage({ params }: UserPageProps) {
  const raw = params?.user ?? 'default'
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  return <UserHomePage userId={normalizeUserId(decoded)} />
}
