import React, { useEffect, useRef, useState } from 'react'
import { createRealtimeSession } from './realtime-webrtc.js'
import DebugPanel, { patchConsole } from './DebugPanel'

function fmt(ms){ const s=Math.floor(ms/1000); const m=String(Math.floor(s/60)).padStart(2,'0'); return `${m}:${String(s%60).padStart(2,'0')}` }

export default function App(){
  const [email, setEmail] = useState('a@sarva.co')
  const [phase, setPhase] = useState('idle')   // idle | connecting | live | saving | error
  const [elapsed, setElapsed] = useState(0)
  const [blob, setBlob] = useState(null)
  const [history, setHistory] = useState([])
  const [debugMode, setDebugMode] = useState(false)

  const audioRef = useRef(null)
  const connRef = useRef(null)
  const timerRef = useRef(null)

  const status =
    phase === 'idle' ? 'Ready' :
    phase === 'connecting' ? 'Connecting…' :
    phase === 'live' ? 'Live' :
    phase === 'saving' ? 'Saving…' :
    'Error'

  useEffect(()=>{
    patchConsole()
    fetch('/api/get-history' + (debugMode ? '?debug=1' : '')).then(r=>r.json()).then(d=>{
      if(Array.isArray(d?.items)) setHistory(d.items)
      if (debugMode && d?.debugInfo) d.debugInfo.forEach(m => console.log('[SERVER]', m))
    }).catch(()=>{})
  }, [debugMode])

  async function start(){
    setPhase('connecting'); setElapsed(0);
    try{
      const conn = await createRealtimeSession({
        onRemoteStream: (remote) => {
          if (audioRef.current){ audioRef.current.srcObject = remote; audioRef.current.play().catch(()=>{}) }
        }
      })
      connRef.current = conn
      conn.startRecording()
      setPhase('live')
      timerRef.current = setInterval(()=> setElapsed(e => e + 200), 200)
      conn.say("Welcome to the interview app. We are going to do some interviewing about your history and life. Just press record there and you and I will have a conversation.")
    }catch(e){
      console.error(e)
      setPhase('error')
      setTimeout(()=> setPhase('idle'), 1500)
      alert(e.message || 'Failed to connect. Check mic permission and server logs.')
    }
  }

  async function stop(){
    if(phase !== 'live') return
    clearInterval(timerRef.current)
    setPhase('saving')
    if(!connRef.current) return
    const b = await connRef.current.stopAndGetBlob().catch(()=>null)
    connRef.current.close()
    setBlob(b)

    try{
      const fd = new FormData()
      fd.append('email', email || 'a@sarva.co')
      fd.append('timestamp', new Date().toISOString())
      fd.append('transcript', '(mixed recording of user + assistant)')
      if (b) fd.append('audio', b, 'interview.webm')
      const res = await fetch('/api/save-interview', { method:'POST', body: fd })
      const data = await res.json().catch(()=>({}))
      if(res.ok){
        setHistory(h => [{ id: data.id, timestamp: data.timestamp, audioUrl: data.audioUrl, transcriptUrl: data.transcriptUrl }, ...h])
        setPhase('idle')
      } else {
        throw new Error(data?.error || 'Upload failed')
      }
    }catch(err){
      console.error(err)
      setPhase('error')
      setTimeout(()=> setPhase('idle'), 1500)
    }
  }

  const btnLabel =
    phase === 'idle' ? '● START CONVERSATION' :
    phase === 'connecting' ? '… CONNECTING' :
    phase === 'live' ? '■ STOP' :
    phase === 'saving' ? '… SAVING' :
    'RETRY'

  const btnOnClick = phase === 'live' ? stop : start
  const timerText = phase === 'live' ? fmt(elapsed) : (blob ? 'Saved after stop' : '00:00')

  return (
    <div>
      <div className="container">
        {/* rest of your existing app UI */}
        <header className="header">
          <div className="brand">
            <img src="/logo.svg" alt="logo" width="40" height="40" />
            <div>
              <h1>Interview App (Realtime)</h1>
              <p>True voice conversation. Public history. One-button flow.</p>
            </div>
          </div>
          <span className="mini">{status}</span>
        </header>

        <div className="card">
          <div className="hero">
            <button className={`big ${phase==='live'?'danger':''}`} onClick={btnOnClick} disabled={phase==='saving'}>
              {btnLabel}
            </button>
            <div className="timer" aria-live="polite">{timerText}</div>
          </div>

          <div className="grid">
            <div className="box">
              <div className="label">Assistant Audio</div>
              <audio ref={audioRef} autoPlay playsInline />
            </div>
            <div className="box">
              <div className="label">Logging email</div>
              <input className="input" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" />
              <div className="mini" style={{marginTop:6}}>Used for send-on-save. Defaults to a@sarva.co.</div>
            </div>
          </div>

          {blob && (
            <div className="box" style={{marginTop:16}}>
              <div className="label">Latest Mixed Recording</div>
              <audio controls src={URL.createObjectURL(blob)} />
            </div>
          )}
        </div>

        <div className="history">
          <h3>Interview History</h3>
          <div className="history-list">
            {history.length===0 && <div className="mini">No interviews yet.</div>}
            {history.map(x => (
              <div key={x.id} className="item">
                <div>
                  <div><strong>{new Date(x.timestamp||Date.now()).toLocaleString()}</strong></div>
                  <div className="mini">{x.id}</div>
                </div>
                <div style={{display:'flex',gap:12}}>
                  <a href={x.audioUrl} target="_blank" rel="noreferrer">Audio</a>
                  <a href={x.transcriptUrl} target="_blank" rel="noreferrer">Transcript</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        style={{
          position: 'fixed', bottom: 80, right: 20, zIndex: 1002,
          background: debugMode ? '#444' : '#ccc', color: '#fff',
          borderRadius: 4, padding: '8px 16px', border: 'none'
        }}
        onClick={() => setDebugMode(m => !m)}
      >
        Debug Mode: {debugMode ? 'ON' : 'OFF'}
      </button>

      <DebugPanel />
    </div>
  )
}