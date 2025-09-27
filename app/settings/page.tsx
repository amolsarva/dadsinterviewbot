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

export function SettingsView({ userHandle }: { userHandle?: string }) {
  const normalizedPropHandle = normalizeHandle(userHandle)
  const [email, setEmail] = useState('')
  const [sendEmails, setSendEmails] = useState(true)
  const [saved, setSaved] = useState(false)
  const [activeHandle, setActiveHandle] = useState<string | undefined>(normalizedPropHandle)

  useEffect(() => {
    if (typeof window === 'undefined') {
      setEmail(DEFAULT_NOTIFY_EMAIL)
      setSendEmails(true)
      setActiveHandle(undefined)
      return
    }

    try {
      const storedHandle = normalizedPropHandle
        ? normalizedPropHandle
        : normalizeHandle(window.localStorage.getItem(ACTIVE_USER_HANDLE_STORAGE_KEY))
      if (normalizedPropHandle) {
        window.localStorage.setItem(ACTIVE_USER_HANDLE_STORAGE_KEY, normalizedPropHandle)
      }
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
  }, [normalizedPropHandle])

  useEffect(() => {
    setSaved(false)
  }, [email, sendEmails])

  return (
    <main>
      <div className="panel-card settings-card">
        <h2 className="page-heading">Settings</h2>
        {activeHandle && (
          <p className="page-subtext">
            Active account: <span className="highlight">@{activeHandle}</span>
          </p>
        )}
        <div className="settings-field">
          <label htmlFor="notify-email">Default notify email</label>
          <input
            id="notify-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={sendEmails}
            onChange={(e) => setSendEmails(e.target.checked)}
          />
          <span>Send session summaries by email</span>
        </label>
        <div className="settings-actions">
          <button
            onClick={() => {
              const emailKey = scopedStorageKey(EMAIL_STORAGE_BASE_KEY, activeHandle)
              const enabledKey = scopedStorageKey(EMAIL_ENABLED_STORAGE_BASE_KEY, activeHandle)
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(emailKey, email)
                window.localStorage.setItem(enabledKey, sendEmails ? 'true' : 'false')
              }
              setSaved(true)
            }}
          >
            Save
          </button>
          {saved && <span className="status-note">Saved.</span>}
        </div>
      </div>
    </main>
  )
}

export default function SettingsPage() {
  return <SettingsView />
}
