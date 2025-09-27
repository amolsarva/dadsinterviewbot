import { SettingsView } from '../../../settings/page'

export default function UserSettingsPage({ params }: { params: { handle: string } }) {
  const handle = params.handle || ''
  return <SettingsView key={`settings:${handle.toLowerCase()}`} userHandle={handle} />
}
