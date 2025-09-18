"use client"
import { useEffect, useState } from 'react'

type Row = {
  id: string
  created_at: string
  title: string | null
  status: string
  total_turns: number
  artifacts: {
    transcript_txt?: string | null
    transcript_json?: string | null
    session_manifest?: string | null
    session_audio?: string | null
  }
  manifestUrl?: string | null
  firstAudioUrl?: string | null
  sessionAudioUrl?: string | null
}

export default function HistoryPage() {
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    async function load() {
      try {
        const api = await (await fetch('/api/history')).json()
        const serverRows: Row[] = api?.items || []
        let demoRows: Row[] = []
        try {
          const raw = localStorage.getItem('demoHistory')
          if (raw) {
            const list = JSON.parse(raw) as { id:string, created_at:string }[]
            demoRows = list.map(d => ({ id: d.id, created_at: d.created_at, title: 'Demo session', status:'completed', total_turns: 1, artifacts:{} }))
          }
        } catch {}
        setRows([...(demoRows||[]), ...(serverRows||[])])
      } catch {
        setRows([])
      }
    }
    load()
  }, [])

  return (
    <main>
      <h2 className="text-lg font-semibold mb-4">Sessions</h2>
      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/70">
          <p className="font-medium text-white">No interviews yet.</p>
          <p className="mt-1">Run a mock session from the home page or execute diagnostics to record a sample conversation. Your completed interviews will appear here once they are saved.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map(s => (
            <li key={s.id} className="bg-white/5 rounded p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.title || 'Untitled session'}</div>
                  <div className="text-xs opacity-70">{new Date(s.created_at).toLocaleString()}</div>
                  <div className="text-xs opacity-70">Turns: {s.total_turns} • Status: {s.status}</div>
                </div>
                <div className="flex flex-col gap-2 text-sm max-w-xl">
                  {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                    <audio
                      controls
                      src={(s.sessionAudioUrl || s.artifacts?.session_audio) ?? undefined}
                      className="w-full"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <a className="underline" href={`/session/${s.id}`}>
                      Open
                    </a>
                    {(s.manifestUrl || s.artifacts?.session_manifest) && (
                      <a
                        className="underline"
                        href={(s.manifestUrl || s.artifacts?.session_manifest) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Session manifest
                      </a>
                    )}
                    {s.firstAudioUrl && (
                      <a className="underline" href={s.firstAudioUrl} target="_blank" rel="noreferrer">
                        First turn audio
                      </a>
                    )}
                    {s.artifacts?.transcript_txt && (
                      <a className="underline" href={s.artifacts.transcript_txt} target="_blank" rel="noreferrer">
                        Transcript (txt)
                      </a>
                    )}
                    {s.artifacts?.transcript_json && (
                      <a className="underline" href={s.artifacts.transcript_json} target="_blank" rel="noreferrer">
                        Transcript (json)
                      </a>
                    )}
                    {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                      <a
                        className="underline"
                        href={(s.sessionAudioUrl || s.artifacts?.session_audio) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download session audio
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
