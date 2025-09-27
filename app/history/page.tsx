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
      <div className="panel-card">
        <h2 className="page-heading">Sessions</h2>
        {activeHandle && (
          <p className="page-subtext">
            Showing sessions saved for <span className="highlight">@{activeHandle}</span>
          </p>
        )}
        {rows.length === 0 ? (
          <div className="history-empty">
            <p className="font-medium">No interviews yet.</p>
            <p className="mt-1">
              Run a mock session from the home page or execute diagnostics to record a sample conversation. Your completed
              interviews will appear here once they are saved.
            </p>
          </div>
        ) : (
          <ul className="history-list">
            {rows.map((s) => (
              <li key={s.id} className="history-item">
                <div className="history-item-header">
                  <h3>{s.title || `Session from ${new Date(s.created_at).toLocaleString()}`}</h3>
                  <div className="history-meta">{new Date(s.created_at).toLocaleString()}</div>
                  <div className="history-meta">Turns: {s.total_turns} • Status: {s.status}</div>
                </div>
                <div className="history-item-body">
                  <div className="history-actions">
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id || clearingAll}
                      className="link-button link-danger"
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
                  </div>
                  <div className="history-links">
                    <a className="link" href={`/session/${s.id}`}>
                      Open
                    </a>
                    {(s.manifestUrl || s.artifacts?.session_manifest) && (
                      <a
                        className="link"
                        href={(s.manifestUrl || s.artifacts?.session_manifest) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Session manifest
                      </a>
                    )}
                    {s.firstAudioUrl && (
                      <a className="link" href={s.firstAudioUrl} target="_blank" rel="noreferrer">
                        First turn audio
                      </a>
                    )}
                    {s.artifacts?.transcript_txt && (
                      <a className="link" href={s.artifacts.transcript_txt} target="_blank" rel="noreferrer">
                        Transcript (txt)
                      </a>
                    )}
                    {s.artifacts?.transcript_json && (
                      <a className="link" href={s.artifacts.transcript_json} target="_blank" rel="noreferrer">
                        Transcript (json)
                      </a>
                    )}
                    {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                      <a
                        className="link"
                        href={(s.sessionAudioUrl || s.artifacts?.session_audio) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download session audio
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="history-footer">
            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearingAll || !!deletingId}
              className="btn-outline"
            >
              {clearingAll ? 'Clearing…' : 'Clear all history'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
