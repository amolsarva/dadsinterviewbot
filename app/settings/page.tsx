'use client'
import { useState, useEffect } from 'react'

export default function SettingsPage() {
  const [email, setEmail] = useState('')
  const [sendEmails, setSendEmails] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setEmail(localStorage.getItem('defaultEmail') || 'a@sarva.co')
    const raw = localStorage.getItem('sendSummaryEmails')
    setSendEmails(raw === null ? true : raw !== 'false')
  }, [])

  useEffect(() => {
    setSaved(false)
  }, [email, sendEmails])

  return (
    <main>
      <h2 className="text-lg font-semibold mb-4">Settings</h2>
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
            localStorage.setItem('defaultEmail', email)
            localStorage.setItem('sendSummaryEmails', sendEmails ? 'true' : 'false')
            setSaved(true)
          }}
          className="bg-white/10 px-4 py-1 rounded"
        >Save</button>
        {saved && <span className="text-xs ml-3 opacity-70">Saved.</span>}
      </div>
    </main>
  )
}
