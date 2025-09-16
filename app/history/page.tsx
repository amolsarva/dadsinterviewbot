"use client"
import { useEffect, useState } from 'react'

type Row = {
  id: string
  created_at: string
  title: string | null
  status: string
  total_turns: number
  artifacts: {
    transcript_txt: string | null
    transcript_json: string | null
    session_manifest: string | null
  }
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
            demoRows = list.map((d) => ({
              id: d.id,
              created_at: d.created_at,
              title: 'Demo session',
              status: 'completed',
              total_turns: 1,
              artifacts: { transcript_txt: null, transcript_json: null, session_manifest: null },
            }))
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
      <ul className="space-y-3">
        {rows.map(s => (
          <li key={s.id} className="bg-white/5 rounded p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{s.title || 'Untitled session'}</div>
                <div className="text-xs opacity-70">{new Date(s.created_at).toLocaleString()}</div>
                <div className="text-xs opacity-70">Turns: {s.total_turns} • Status: {s.status}</div>
              </div>
              <div className="space-x-2 text-sm">
                <a
                  className="underline"
                  href={
                    s.artifacts?.session_manifest
                      ? `/session/${s.id}?manifest=${encodeURIComponent(s.artifacts.session_manifest)}`
                      : `/session/${s.id}`
                  }
                >
                  Open
                </a>
                {s.artifacts?.session_manifest && (
                  <a
                    className="underline"
                    href={s.artifacts.session_manifest}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Session manifest
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
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}
