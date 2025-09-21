"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'

import { normalizeUserId } from '@/lib/users'

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

type HistoryPageProps = {
  userId?: string
}

export function HistoryPageContent({ userId = 'default' }: HistoryPageProps) {
  const normalizedUserId = useMemo(() => normalizeUserId(userId), [userId])
  const [rows, setRows] = useState<Row[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)

  const withUser = useCallback(
    (path: string) => {
      const encoded = encodeURIComponent(normalizedUserId)
      return path.includes('?') ? `${path}&user=${encoded}` : `${path}?user=${encoded}`
    },
    [normalizedUserId],
  )

  const loadHistory = useCallback(async () => {
    try {
      const api = await (await fetch(withUser('/api/history'))).json()
      const serverRows: Row[] = api?.items || []
      let demoRows: Row[] = []
      try {
        const raw = localStorage.getItem('demoHistory')
        if (raw) {
          const list = JSON.parse(raw) as { id: string; created_at: string; title?: string | null }[]
          demoRows = list.map((d) => ({
            id: d.id,
            created_at: d.created_at,
            title: typeof d.title === 'string' && d.title.length ? d.title : null,
            status: 'completed',
            total_turns: 1,
            artifacts: {},
          }))
        }
      } catch {}
      const combined = [...(demoRows || []), ...(serverRows || [])]
      combined.sort((a, b) => {
        const aTime = new Date(a.created_at).getTime()
        const bTime = new Date(b.created_at).getTime()
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0
        if (Number.isNaN(aTime)) return -1
        if (Number.isNaN(bTime)) return 1
        return bTime - aTime
      })
      setRows(combined)
    } catch {
      setRows([])
    }
  }, [withUser])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const removeDemoEntry = useCallback((id: string) => {
    try {
      const raw = localStorage.getItem('demoHistory')
      if (!raw) return
      const list = JSON.parse(raw) as { id: string }[]
      const filtered = list.filter((entry) => entry.id !== id)
      if (filtered.length) {
        localStorage.setItem('demoHistory', JSON.stringify(filtered))
      } else {
        localStorage.removeItem('demoHistory')
      }
    } catch {}
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id)
      try {
        const resp = await fetch(withUser(`/api/history/${id}`), { method: 'DELETE' })
        if (resp.ok) {
          removeDemoEntry(id)
          await loadHistory()
        }
      } finally {
        setDeletingId(null)
      }
    },
    [loadHistory, removeDemoEntry, withUser],
  )

  const handleClearAll = useCallback(async () => {
    setClearingAll(true)
    try {
      const resp = await fetch(withUser('/api/history'), { method: 'DELETE' })
      if (resp.ok) {
        localStorage.removeItem('demoHistory')
        setRows([])
      }
    } finally {
      setClearingAll(false)
    }
  }, [withUser])

  return (
    <main>
      <h2 className="text-lg font-semibold mb-4">Sessions</h2>
      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/70">
          <p className="font-medium text-white">No interviews yet.</p>
          <p className="mt-1">
            Run a mock session from the home page or execute diagnostics to record a sample conversation. Your completed
            interviews will appear here once they are saved.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li key={s.id} className="bg-white/5 rounded p-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {s.title || `Session from ${new Date(s.created_at).toLocaleString()}`}
                  </div>
                  <div className="text-xs opacity-70">{new Date(s.created_at).toLocaleString()}</div>
                  <div className="text-xs opacity-70">Turns: {s.total_turns} • Status: {s.status}</div>
                </div>
                <div className="flex flex-col gap-2 text-sm max-w-xl items-end">
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id || clearingAll}
                    className="text-xs text-red-200/80 hover:text-red-100 disabled:opacity-50"
                    aria-label="Delete session"
                  >
                    {deletingId === s.id ? 'Deleting…' : '🗑 Remove'}
                  </button>
                  {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                    <audio
                      controls
                      src={(s.sessionAudioUrl || s.artifacts?.session_audio) ?? undefined}
                      className="w-full"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <a className="underline" href={withUser(`/session/${s.id}`)}>
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
      {rows.length > 0 && (
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleClearAll}
            disabled={clearingAll || !!deletingId}
            className="rounded border border-white/20 px-3 py-1 text-sm text-white/80 hover:border-white/40 hover:text-white disabled:opacity-50"
          >
            {clearingAll ? 'Clearing…' : 'Clear all history'}
          </button>
        </div>
      )}
    </main>
  )
}
