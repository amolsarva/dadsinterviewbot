"use client"
import { useCallback, useEffect, useState } from 'react'
import {
  ACTIVE_USER_HANDLE_STORAGE_KEY,
  DEMO_HISTORY_BASE_KEY,
  normalizeHandle,
  scopedStorageKey,
} from '@/lib/user-scope'

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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [activeHandle, setActiveHandle] = useState<string | undefined>(undefined)

  const getActiveHandle = useCallback(() => {
    if (typeof window === 'undefined') return undefined
    try {
      const stored = window.localStorage.getItem(ACTIVE_USER_HANDLE_STORAGE_KEY)
      return normalizeHandle(stored)
    } catch {
      return undefined
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const handle = getActiveHandle()
      setActiveHandle(handle)
      const query = handle ? `?handle=${encodeURIComponent(handle)}` : ''
      const api = await (await fetch(`/api/history${query}`)).json()
      const serverRows: Row[] = api?.items || []
      let demoRows: Row[] = []
      try {
        const key = scopedStorageKey(DEMO_HISTORY_BASE_KEY, handle)
        const raw = localStorage.getItem(key)
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
  }, [getActiveHandle])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const removeDemoEntry = useCallback((id: string) => {
    try {
      const handle = getActiveHandle()
      const key = scopedStorageKey(DEMO_HISTORY_BASE_KEY, handle)
      const raw = localStorage.getItem(key)
      if (!raw) return
      const list = JSON.parse(raw) as { id: string }[]
      const filtered = list.filter((entry) => entry.id !== id)
      if (filtered.length) {
        localStorage.setItem(key, JSON.stringify(filtered))
      } else {
        localStorage.removeItem(key)
      }
    } catch {}
  }, [getActiveHandle])

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id)
      try {
        const resp = await fetch(`/api/history/${id}`, { method: 'DELETE' })
        if (resp.ok) {
          removeDemoEntry(id)
          await loadHistory()
        }
      } finally {
        setDeletingId(null)
      }
    },
    [loadHistory, removeDemoEntry],
  )

  const handleClearAll = useCallback(async () => {
    setClearingAll(true)
    try {
      const handle = getActiveHandle()
      const query = handle ? `?handle=${encodeURIComponent(handle)}` : ''
      const resp = await fetch(`/api/history${query}`, { method: 'DELETE' })
      if (resp.ok) {
        if (typeof window !== 'undefined') {
          const scopedKey = scopedStorageKey(DEMO_HISTORY_BASE_KEY, handle)
          localStorage.removeItem(scopedKey)
        }
        setRows([])
      }
    } finally {
      setClearingAll(false)
    }
  }, [getActiveHandle])

  return (
    <main>
      <h2 className="text-lg font-semibold mb-4">Sessions</h2>
      {activeHandle && (
        <p className="-mt-2 mb-4 text-xs text-white/60">
          Showing sessions saved for <span className="font-semibold text-white">@{activeHandle}</span>
        </p>
      )}
      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/70">
          <p className="font-medium text-white">No interviews yet.</p>
          <p className="mt-1">Run a mock session from the home page or execute diagnostics to record a sample conversation. Your completed interviews will appear here once they are saved.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li key={s.id} className="rounded bg-white/5 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex-1 min-w-[220px]">
                  <div className="font-medium">
                    {s.title || `Session from ${new Date(s.created_at).toLocaleString()}`}
                  </div>
                  <div className="text-xs opacity-70">{new Date(s.created_at).toLocaleString()}</div>
                  <div className="text-xs opacity-70">Turns: {s.total_turns} • Status: {s.status}</div>
                </div>
                <div className="flex w-full flex-col items-stretch gap-3 text-sm sm:w-auto sm:items-end">
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id || clearingAll}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/30"
                      aria-label="Delete session"
                    >
                      {deletingId === s.id ? (
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent"
                        />
                      ) : (
                        <span aria-hidden="true">🗑</span>
                      )}
                    </button>
                  </div>
                  {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                    <audio
                      controls
                      src={(s.sessionAudioUrl || s.artifacts?.session_audio) ?? undefined}
                      className="w-full sm:w-60"
                    />
                  )}
                  <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
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
