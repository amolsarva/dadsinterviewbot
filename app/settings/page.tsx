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
    <main>
      <h2 className="text-lg font-semibold mb-4">Settings</h2>
      {activeHandle && (
        <p className="-mt-2 mb-4 text-xs text-white/60">Active account: <span className="font-semibold text-white">@{activeHandle}</span></p>
      )}
      <label className="block text-sm mb-1">Default notify email</label>
      <input value={email} onChange={e=>setEmail(e.target.value)} className="bg-white/10 rounded p-2 w-full max-w-md" />
      <label className="flex items-center gap-2 text-sm mt-4">
        <input
          type="checkbox"
          checked={sendEmails}
          onChange={e => setSendEmails(e.target.checked)}
        />
        <span>Send session summaries by email</span>
      </label>
      <div className="mt-3">
        <button
          onClick={()=>{
            const emailKey = scopedStorageKey(EMAIL_STORAGE_BASE_KEY, activeHandle)
            const enabledKey = scopedStorageKey(EMAIL_ENABLED_STORAGE_BASE_KEY, activeHandle)
            localStorage.setItem(emailKey, email)
            localStorage.setItem(enabledKey, sendEmails ? 'true' : 'false')
            setSaved(true)
          }}
          className="bg-white/10 px-4 py-1 rounded"
        >Save</button>
        {saved && <span className="text-xs ml-3 opacity-70">Saved.</span>}
      </div>
    </main>
  )
}
