import React, { useEffect, useRef, useState } from 'react'
import { createRealtimeSession } from './realtime-webrtc.js'
import DebugPanel, { patchConsole } from './DebugPanel'
import { runSmokeTests } from './smoke-tests'

function fmt(ms){ const s=Math.floor(ms/1000); const m=String(Math.floor(s/60)).padStart(2,'0'); return `${m}:${String(s%60).padStart(2,'0')}` }

export default function App(){
  const [email, setEmail] = useState('a@sarva.co')
  const [phase, setPhase] = useState('idle')   // idle | connecting | live | saving | error
  const [elapsed, setElapsed] = useState(0)
  const [blob, setBlob] = useState(null)
  const [history, setHistory] = useState([])
  const [debugMode, setDebugMode] = useState(false)
  useEffect(()=>{ try{ patchConsole(); console.info('[BOOT] UI mounted'); runSmokeTests(); }catch(e){ console.error('[BOOT] smoke failed to start', e); } },[])

  const audioRef = useRef(null)

  const recRef = useRef(null)
  const mediaRef = useRef(null)

  async function startPTT(){
    try{
      console.time('[PTT] getUserMedia')
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true })
      console.timeEnd('[PTT] getUserMedia')
      mediaRef.current = stream
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const chunks = []
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const arr = await blob.arrayBuffer()
        const b64 = btoa(String.fromCharCode(...new Uint8Array(arr)))
        console.time('[ASK] /api/ask-audio')
        const res = await fetch('/api/ask-audio', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ audio: b64, format: 'webm', text: '' })
        })
        const json = await res.json().catch(()=>null)
        console.timeEnd('[ASK] /api/ask-audio')
        if (!res.ok || !json?.ok) {
          console.error('[ASK] error', json || res.status)
          alert('Ask failed: see console.')
          return
        }
        if (json.text) console.log('[ASK] text:', json.text)
        if (json.audio) {
          const bytes = Uint8Array.from(atob(json.audio), c=>c.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/'+(json.format||'mp3') }))
          if (audioRef.current) { audioRef.current.src = url; audioRef.current.play().catch(()=>{}) }
        }
      }
      recRef.current = rec
      rec.start()
      setPhase('live')
      console.log('[PTT] recording started')
    }catch(e){
      console.error('[PTT] start error', e?.message||e)
      setPhase('error'); setTimeout(()=> setPhase('idle'), 1200)
    }
  }

  function stopPTT(){
    try{
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
      if (mediaRef.current) mediaRef.current.getTracks().forEach(t=>t.stop())
      setPhase('saving')
      console.log('[PTT] recording stopped; sending...')
      setTimeout(()=> setPhase('idle'), 600)
    }catch(e){
      console.error('[PTT] stop error', e?.message||e)
      setPhase('idle')
    }
  }

  async function runHealth(){
    try{
      console.time('[HEALTH]');
      const r = await fetch('/api/health');
      const j = await r.json();
      console.timeEnd('[HEALTH]');
      console.log('[HEALTH]', JSON.stringify(j, null, 2));
      if(!j.ok) alert('Health check found issues. See console for details.');
      return j;
    }catch(e){
      console.error('[HEALTH] error', e?.message||e);
    }
  }

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
              <h1>Dad's Interview Bot</h1>

        <div style={{display:'flex', gap:8, margin:'12px 0'}}>
          <button onMouseDown={startPTT} onMouseUp={stopPTT} onTouchStart={startPTT} onTouchEnd={stopPTT}
            style={{padding:'10px 14px', borderRadius:10, border:'1px solid #88a', background:'#eef', cursor:'pointer'}}>
            🎤 PTT (hold-to-talk)
          </button>
          <button onClick={()=>{ startPTT(); setTimeout(stopPTT, 4500); }}
            style={{padding:'10px 14px', borderRadius:10, border:'1px solid #8a8', background:'#efe', cursor:'pointer'}}>
            ▶️ Quick 4s Test
          </button>
        </div>

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

      
      {/* Floating features box */}
      <div className="features-box" style={{
        position:'fixed', left:'50%', transform:'translateX(-50%)',
        bottom: 20, zIndex: 900, maxWidth: 920, width: 'calc(100% - 32px)',
        background: 'linear-gradient(180deg, var(--panel), var(--panel-2))',
        border: '1px solid rgba(255,255,255,.08)',
        boxShadow: '0 10px 30px rgba(0,0,0,.35)',
        borderRadius: 16, padding: 16
      }}>
        <div style={{display:'flex', gap:12, alignItems:'flex-start'}}>
          <div style={{fontSize:18, fontWeight:800, whiteSpace:'nowrap'}}>What it does</div>
          <ul style={{margin:0, paddingLeft: '1.2rem', lineHeight:1.45}}>
            <li>Talk, don’t type — mic-first interviews with real-time AI voice.</li>
            <li>Instant responses — powered by OpenAI’s low-latency Realtime API (WebRTC).</li>
            <li>Automatic recording — mixed audio (you + AI) saved securely.</li>
            <li>History at your fingertips — browse past sessions in a public archive.</li>
            <li>Optional email delivery — send conversations straight to your inbox.</li>
            <li>Reliable + private — strong server logging and timeouts keep sessions stable.</li>
          </ul>
        </div>
      </div>

      <div style={{position:'fixed', right:16, bottom:16, display:'flex', gap:8, alignItems:'center', zIndex:9999}}>
        <button onClick={()=>runSmokeTests()} style={{background:'#eef', border:'1px solid #99f', padding:'6px 10px', borderRadius:8, cursor:'pointer'}}>Re-run smoke tests</button><button onClick={()=>runHealth()} style={{background:'#efe', border:'1px solid #9f9', padding:'6px 10px', borderRadius:8, cursor:'pointer'}}>Health check</button>
        </div>
      <DebugPanel />
    </div>
  )
}