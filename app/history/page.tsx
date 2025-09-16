import 'server-only'
import { listSessions } from '@/lib/data'

export default async function HistoryPage() {
  const sessions = await listSessions()
  return (
    <main>
      <h2 className="text-lg font-semibold mb-4">Sessions</h2>
      <ul className="space-y-3">
        {sessions.map(s => (
          <li key={s.id} className="bg-white/5 rounded p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.title || 'Untitled session'}</div>
                <div className="text-xs opacity-70">{new Date(s.created_at).toLocaleString()}</div>
                <div className="text-xs opacity-70">Turns: {s.total_turns} • Status: {s.status}</div>
              </div>
              <div className="space-x-2 text-sm">
                <a className="underline" href={`/session/${s.id}`}>Open</a>
                {s.artifacts?.transcript_txt && <a className="underline" href={s.artifacts.transcript_txt}>Transcript (txt)</a>}
                {s.artifacts?.transcript_json && <a className="underline" href={s.artifacts.transcript_json}>Transcript (json)</a>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
