import React, { useEffect, useRef, useState } from 'react'
import { createRealtimeSession } from './realtime-webrtc.js'

function fmt(ms){ const s=Math.floor(ms/1000); const m=String(Math.floor(s/60)).padStart(2,'0'); return `${m}:${String(s%60).padStart(2,'0')}` }

export default function App(){
  const [email, setEmail] = useState('a@sarva.co')
  const [isLive, setIsLive] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [blob, setBlob] = useState(null)
  const [status, setStatus] = useState('Ready')
  const [history, setHistory] = useState([])

  const audioRef = useRef(null)
  const connRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(()=>{ fetch('/api/get-history').then(r=>r.json()).then(d=>{ if(Array.isArray(d?.items)) setHistory(d.items) }).catch(()=>{}) }, [])

  async function start(){
    setStatus('Connecting…')
    try{
      const conn = await createRealtimeSession({
        onRemoteStream: (remote) => {
          if (audioRef.current){ audioRef.current.srcObject = remote; audioRef.current.play().catch(()=>{}) }
        }
      })
      connRef.current = conn
      conn.startRecording()
      setIsLive(true)
      setElapsed(0)
      timerRef.current = setInterval(()=> setElapsed(e => e + 200), 200)
      setStatus('Live')
      conn.say("Welcome to the interview app. We are going to do some interviewing about your history and life. Just press record there and you and I will have a conversation.")
    }catch(e){
      setStatus('Error: '+e.message)
    }
  }

  async function stop(){
    clearInterval(timerRef.current)
    setStatus('Stopping…')
    if(!connRef.current) return
    const b = await connRef.current.stopAndGetBlob()
    connRef.current.close()
    setIsLive(false)
    setBlob(b)
    setStatus('Saving…')
    try{
      const fd = new FormData()
      fd.append('email', email || 'a@sarva.co')
      fd.append('timestamp', new Date().toISOString())
      fd.append('transcript', '(mixed recording of user + assistant)')
      fd.append('audio', b, 'interview.webm')
      const res = await fetch('/api/save-interview', { method:'POST', body: fd })
      const data = await res.json().catch(()=>({}))
      if(!res.ok) throw new Error(data?.error || 'Upload failed')
      setStatus('Saved!')
      setHistory(h => [{ id: data.id, timestamp: data.timestamp, audioUrl: data.audioUrl, transcriptUrl: data.transcriptUrl }, ...h])
    }catch(err){ setStatus('Save error: '+err.message) }
  }

  return (
    <div className="container">
      <header className="header">
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <img src="/logo.svg" alt="logo" width="40" height="40" />
          <div>
            <h2 style={{margin:'0 0 4px'}}>Interview App (Realtime)</h2>
            <div className="mini">True voice conversation. Public history. One-button flow.</div>
          </div>
        </div>
        <span className="mini">{status}</span>
      </header>

      <div className="card">
        <div style={{display:'flex',gap:16,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
          {!isLive ? (
            <button className="big" onClick={start}>● START CONVERSATION</button>
          ) : (
            <button className="big danger" onClick={stop}>■ STOP</button>
          )}
          <div className="mini" aria-live="polite">{isLive ? fmt(elapsed) : (blob ? 'Saved after stop' : '00:00')}</div>
        </div>

        <div className="grid">
          <div className="box">
            <div className="mini">Assistant Audio</div>
            <audio ref={audioRef} autoPlay playsInline />
          </div>
          <div className="box">
            <div className="mini">Logging email</div>
            <input className="input" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" />
            <div className="mini" style={{marginTop:6}}>Used for send-on-save. Defaults to a@sarva.co.</div>
          </div>
        </div>

        {blob && (
          <div className="box" style={{marginTop:16}}>
            <div className="mini">Latest Mixed Recording (user + assistant)</div>
            <audio controls src={URL.createObjectURL(blob)} />
          </div>
        )}

        <div style={{marginTop:18}}>
          <h3>Interview History</h3>
          <div>
            {history.length===0 && <div className="mini">No interviews yet.</div>}
            {history.map(x => (
              <div key={x.id} style={{display:'flex',justifyContent:'space-between',gap:12,margin:'8px 0',padding:'10px',border:'1px solid rgba(255,255,255,.08)',borderRadius:12,background:'#0b1322'}}>
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
    </div>
  )
}
