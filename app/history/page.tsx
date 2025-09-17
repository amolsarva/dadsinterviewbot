"use client"
import { useEffect, useState } from 'react'

type Row = { id: string, created_at: string, title: string|null, status: string, total_turns: number, artifacts: { transcript_txt: boolean, transcript_json: boolean } }

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
            demoRows = list.map(d => ({ id: d.id, created_at: d.created_at, title: 'Demo session', status:'completed', total_turns: 1, artifacts:{ transcript_txt:false, transcript_json:false } }))
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
                <div className="space-x-2 text-sm">
                  <a className="underline" href={`/session/${s.id}`}>Open</a>
                  {s.artifacts?.transcript_txt && <a className="underline" href="#">Transcript (txt)</a>}
                  {s.artifacts?.transcript_json && <a className="underline" href="#">Transcript (json)</a>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
