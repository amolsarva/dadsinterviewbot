'use client'
import { useState, useEffect } from 'react'

export default function SettingsPage() {
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setEmail(localStorage.getItem('defaultEmail') || 'a@sarva.co')
  }, [])

  return (
    <main>
      <h2 className="text-lg font-semibold mb-4">Settings</h2>
      <label className="block text-sm mb-1">Default notify email</label>
      <input value={email} onChange={e=>setEmail(e.target.value)} className="bg-white/10 rounded p-2 w-full max-w-md" />
      <div className="mt-3">
        <button onClick={()=>{ localStorage.setItem('defaultEmail', email); setSaved(true); }} className="bg-white/10">Save</button>
        {saved && <span className="text-xs ml-3 opacity-70">Saved.</span>}
      </div>
    </main>
  )
}
