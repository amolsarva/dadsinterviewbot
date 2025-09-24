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
    <main className="flex flex-col gap-6 text-[rgba(255,247,237,0.9)]">
      <div>
        <h2 className="text-2xl font-semibold text-white">Sessions</h2>
        {activeHandle && (
          <p className="mt-1 text-xs text-[rgba(255,247,237,0.7)]">
            Showing sessions saved for <span className="font-semibold text-white">@{activeHandle}</span>
          </p>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[rgba(255,214,150,0.35)] bg-[rgba(33,12,53,0.55)] p-6 text-sm leading-relaxed text-[rgba(255,247,237,0.78)] shadow-[0_18px_50px_rgba(120,45,110,0.25)]">
          <p className="font-medium text-white">No interviews yet.</p>
          <p className="mt-2">Brew a fresh cup of chai and record a new memory from the home page—your saved sessions will glow here once they are captured.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((s) => (
            <li
              key={s.id}
              className="rounded-3xl border border-[rgba(255,214,150,0.28)] bg-[rgba(24,9,42,0.7)] p-4 shadow-[0_18px_60px_rgba(120,45,110,0.28)]"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex min-w-[220px] flex-1 flex-col gap-1 text-left">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span aria-hidden>🪷</span>
                    <span>{s.title || `Session from ${new Date(s.created_at).toLocaleString()}`}</span>
                  </div>
                  <div className="text-xs text-[rgba(255,247,237,0.65)]">{new Date(s.created_at).toLocaleString()}</div>
                  <div className="text-xs text-[rgba(255,247,237,0.65)]">Turns: {s.total_turns} • Status: {s.status}</div>
                </div>
                <div className="flex w-full flex-col items-stretch gap-3 text-sm sm:w-auto sm:items-end">
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={deletingId === s.id || clearingAll}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(249,115,22,0.35)] bg-[rgba(249,115,22,0.12)] text-[rgba(255,247,237,0.85)] transition hover:border-[rgba(249,115,22,0.6)] hover:bg-[rgba(249,115,22,0.22)] hover:text-white disabled:cursor-not-allowed disabled:border-[rgba(255,214,150,0.15)] disabled:text-[rgba(255,247,237,0.4)]"
                      aria-label="Delete session"
                    >
                      {deletingId === s.id ? (
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(255,247,237,0.85)] border-t-transparent"
                        />
                      ) : (
                        <span aria-hidden="true">🪣</span>
                      )}
                    </button>
                  </div>
                  {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                    <audio
                      controls
                      src={(s.sessionAudioUrl || s.artifacts?.session_audio) ?? undefined}
                      className="w-full rounded-lg bg-[rgba(10,4,24,0.8)] sm:w-60"
                    />
                  )}
                  <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                    <a
                      className="rounded-full border border-[rgba(249,115,22,0.4)] px-3 py-1 text-xs font-medium text-[rgba(255,247,237,0.9)] underline decoration-[rgba(249,115,22,0.5)] transition hover:bg-[rgba(249,115,22,0.2)]"
                      href={`/session/${s.id}`}
                    >
                      Open
                    </a>
                    {(s.manifestUrl || s.artifacts?.session_manifest) && (
                      <a
                        className="rounded-full border border-[rgba(156,163,255,0.35)] px-3 py-1 text-xs text-[rgba(255,247,237,0.85)] underline decoration-[rgba(156,163,255,0.4)] transition hover:bg-[rgba(129,140,248,0.18)]"
                        href={(s.manifestUrl || s.artifacts?.session_manifest) ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Session manifest
                      </a>
                    )}
                    {s.firstAudioUrl && (
                      <a
                        className="rounded-full border border-[rgba(16,185,129,0.35)] px-3 py-1 text-xs text-[rgba(209,250,229,0.9)] underline decoration-[rgba(16,185,129,0.4)] transition hover:bg-[rgba(16,185,129,0.2)]"
                        href={s.firstAudioUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        First turn audio
                      </a>
                    )}
                    {s.artifacts?.transcript_txt && (
                      <a
                        className="rounded-full border border-[rgba(129,140,248,0.35)] px-3 py-1 text-xs text-[rgba(255,247,237,0.85)] underline decoration-[rgba(129,140,248,0.35)] transition hover:bg-[rgba(129,140,248,0.18)]"
                        href={s.artifacts.transcript_txt}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Transcript (txt)
                      </a>
                    )}
                    {s.artifacts?.transcript_json && (
                      <a
                        className="rounded-full border border-[rgba(129,140,248,0.35)] px-3 py-1 text-xs text-[rgba(255,247,237,0.85)] underline decoration-[rgba(129,140,248,0.35)] transition hover:bg-[rgba(129,140,248,0.18)]"
                        href={s.artifacts.transcript_json}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Transcript (json)
                      </a>
                    )}
                    {(s.sessionAudioUrl || s.artifacts?.session_audio) && (
                      <a
                        className="rounded-full border border-[rgba(14,165,233,0.35)] px-3 py-1 text-xs text-[rgba(224,242,254,0.9)] underline decoration-[rgba(56,189,248,0.4)] transition hover:bg-[rgba(14,165,233,0.18)]"
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
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClearAll}
            disabled={clearingAll || !!deletingId}
            className="rounded-full border border-[rgba(249,115,22,0.4)] bg-[rgba(249,115,22,0.18)] px-4 py-2 text-sm font-medium text-[rgba(255,247,237,0.9)] transition hover:border-[rgba(249,115,22,0.6)] hover:bg-[rgba(249,115,22,0.3)] hover:text-white disabled:cursor-not-allowed disabled:border-[rgba(255,214,150,0.2)] disabled:bg-[rgba(249,115,22,0.08)] disabled:text-[rgba(255,247,237,0.45)]"
          >
            {clearingAll ? 'Clearing…' : 'Clear all history'}
          </button>
        </div>
      )}
    </main>
  )

}
