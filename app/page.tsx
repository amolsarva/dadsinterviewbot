import UserHomePage from './user-home'
import { DEFAULT_USER_ID } from '@/lib/users'

export default function RootPage() {
  return <UserHomePage userId={DEFAULT_USER_ID} />
}
