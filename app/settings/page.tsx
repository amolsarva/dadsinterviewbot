"use client"
import { useState, useEffect } from 'react'
import {
  ACTIVE_USER_HANDLE_STORAGE_KEY,
  DEFAULT_NOTIFY_EMAIL,
  EMAIL_ENABLED_STORAGE_BASE_KEY,
  EMAIL_STORAGE_BASE_KEY,
  normalizeHandle,
  scopedStorageKey,
} from '@/lib/user-scope'

export default function SettingsPage() {
  const [email, setEmail] = useState('')
  const [sendEmails, setSendEmails] = useState(true)
  const [saved, setSaved] = useState(false)
  const [activeHandle, setActiveHandle] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (typeof window === 'undefined') {
      setEmail(DEFAULT_NOTIFY_EMAIL)
      setSendEmails(true)
      setActiveHandle(undefined)
      return
    }
    try {
      const storedHandle = normalizeHandle(window.localStorage.getItem(ACTIVE_USER_HANDLE_STORAGE_KEY))
      setActiveHandle(storedHandle)
      const emailKey = scopedStorageKey(EMAIL_STORAGE_BASE_KEY, storedHandle)
      setEmail(window.localStorage.getItem(emailKey) || DEFAULT_NOTIFY_EMAIL)
      const enabledKey = scopedStorageKey(EMAIL_ENABLED_STORAGE_BASE_KEY, storedHandle)
      const raw = window.localStorage.getItem(enabledKey)
      setSendEmails(raw === null ? true : raw !== 'false')
    } catch {
      setEmail(DEFAULT_NOTIFY_EMAIL)
      setSendEmails(true)
      setActiveHandle(undefined)
    }
  }, [])

  useEffect(() => {
    setSaved(false)
  }, [email, sendEmails])

  return (
    <main className="flex flex-col gap-6 text-[rgba(255,247,237,0.9)]">
      <div>
        <h2 className="text-2xl font-semibold text-white">Settings</h2>
        {activeHandle && (
          <p className="mt-1 text-xs text-[rgba(255,247,237,0.7)]">
            Active account: <span className="font-semibold text-white">@{activeHandle}</span>
          </p>
        )}
      </div>
      <section className="rounded-3xl border border-[rgba(255,214,150,0.28)] bg-[rgba(24,9,42,0.72)] p-6 shadow-[0_18px_60px_rgba(120,45,110,0.28)]">
        <p className="text-sm text-[rgba(255,247,237,0.75)]">
          Personalize how we keep in touch after each interview. All settings stay linked to your handle, so every family member can choose what feels right.
        </p>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-white/90">Default notify email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full max-w-md rounded-2xl border border-[rgba(156,163,255,0.35)] bg-[rgba(10,4,24,0.85)] px-4 py-2 text-[rgba(255,247,237,0.92)] shadow-[0_10px_35px_rgba(91,33,182,0.25)] focus:outline-none focus:ring-2 focus:ring-[rgba(249,115,22,0.45)]"
            placeholder="you@example.com"
          />
          <label className="flex items-start gap-3 text-sm text-[rgba(255,247,237,0.85)]">
            <input
              type="checkbox"
              checked={sendEmails}
              onChange={(e) => setSendEmails(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[rgba(255,214,150,0.5)] bg-[rgba(249,115,22,0.15)] text-[rgba(249,115,22,0.9)] focus:ring-[rgba(249,115,22,0.5)]"
            />
            <span>Send session summaries by email</span>
          </label>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => {
              const emailKey = scopedStorageKey(EMAIL_STORAGE_BASE_KEY, activeHandle)
              const enabledKey = scopedStorageKey(EMAIL_ENABLED_STORAGE_BASE_KEY, activeHandle)
              localStorage.setItem(emailKey, email)
              localStorage.setItem(enabledKey, sendEmails ? 'true' : 'false')
              setSaved(true)
            }}
            className="rounded-full border border-[rgba(249,115,22,0.45)] bg-gradient-to-r from-[#f59e0b] via-[#f97316] to-[#d946ef] px-6 py-2 text-sm font-semibold text-white shadow-[0_15px_45px_rgba(249,115,22,0.35)] transition hover:from-[#f97316] hover:via-[#ec4899] hover:to-[#8b5cf6]"
          >
            Save preferences
          </button>
          {saved && <span className="text-xs text-[rgba(255,247,237,0.7)]">Saved.</span>}
        </div>
      </section>
    </main>
  )
}
