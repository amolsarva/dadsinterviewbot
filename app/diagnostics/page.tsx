'use client'
import { useState } from 'react'

export default function DiagnosticsPage() {
  const [log, setLog] = useState<string>('Ready. Click a test.')

  const append = (line: string) => setLog(l => l + '\n' + line)

  async function runHealth() {
    append('→ /api/health')
    try {
      const res = await fetch('/api/health')
      const j = await res.json()
      append(JSON.stringify(j, null, 2))
    } catch (e:any) {
      append('Health failed: ' + (e?.message || 'error'))
    }
  }

  async function runSmoke() {
    append('→ /api/diagnostics/smoke')
    try {
      const res = await fetch('/api/diagnostics/smoke', { method: 'POST' })
      const j = await res.json()
      append(JSON.stringify(j, null, 2))
    } catch (e:any) {
      append('Smoke failed: ' + (e?.message || 'error'))
    }
  }

  return (
    <main>
      <h2 className="text-lg font-semibold mb-3">Diagnostics</h2>
      <div className="flex gap-3 mb-3">
        <button onClick={runHealth} className="bg-white/10 px-3 py-1 rounded-2xl">Run Health</button>
        <button onClick={runSmoke} className="bg-white/10 px-3 py-1 rounded-2xl">Run Smoke Test</button>
      </div>
      <textarea value={log} readOnly className="w-full h-96 bg-black/30 p-2 rounded" />
    </main>
  )
}
