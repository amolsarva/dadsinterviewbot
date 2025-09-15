import 'server-only'
import { getSession } from '@/lib/data'

export default async function SessionPage({ params }: { params: { id: string } }) {
  const s = await getSession(params.id)
  if (!s) return <main>Not found.</main>
  return (
    <main>
      <h2 className="text-lg font-semibold mb-2">{s.title || 'Session'}</h2>
      <div className="text-xs opacity-70 mb-4">{new Date(s.created_at).toLocaleString()}</div>
      <div className="space-y-2">
        {s.turns?.map(t => (
          <div key={t.id} className="bg-white/5 rounded p-2">
            <div className="text-xs opacity-70">{t.role}</div>
            <div className="whitespace-pre-wrap">{t.text}</div>
            {t.audio_blob_url && <audio controls src={t.audio_blob_url} className="w-full mt-1" />}
          </div>
        ))}
      </div>
      <div className="mt-4 space-x-3 text-sm">
        {s.artifacts?.transcript_txt && <a className="underline" href={s.artifacts.transcript_txt}>Transcript (txt)</a>}
        {s.artifacts?.transcript_json && <a className="underline" href={s.artifacts.transcript_json}>Transcript (json)</a>}
        {s.artifacts?.audio_user && <a className="underline" href={s.artifacts.audio_user}>User audio</a>}
      </div>
    </main>
  )
}
