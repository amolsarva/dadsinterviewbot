import React, { useState, useRef, useEffect } from 'react'
import { speak, schedulePrompts } from './realtime.js'

function formatTime(ms){ const s=Math.floor(ms/1000); const m=String(Math.floor(s/60)).padStart(2,'0'); const r=String(s%60).padStart(2,'0'); return `${m}:${r}` }

export default function App(){
  const [email, setEmail] = useState('a@sarva.co')
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [status, setStatus] = useState('Ready')
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])
  const [botMuted, setBotMuted] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const startRef = useRef(0)
  const timerRef = useRef(null)
  const stopScheduleRef = useRef(null)

  useEffect(()=>{
    fetch('/api/get-history').then(r=>r.json()).then(data=>{ if(Array.isArray(data?.items)) setHistory(data.items) }).catch(()=>{})
    // Greet on load
    speak('Welcome to the interview app. We are going to do some interviewing about your history and life. Just press record there and you and I will have a conversation.')
    // Schedule prompts
    const prompts=[
      "To begin, tell me where you grew up. What did home feel like?",
      "Who were the people who shaped you most when you were young?",
      "Describe a turning point in your life—what happened, and how did it change you?",
      "Tell me about a risk you took that you're proud of.",
      "What advice would you give your younger self?",
      "What's a story your family always tells about you?",
      "Remember, you can hit save at any time so your memories are safe."
    ]
    stopScheduleRef.current = schedulePrompts(prompts, 45000)
    return ()=> { if(stopScheduleRef.current) stopScheduleRef.current() }
  }, [])

  useEffect(()=>{
    if(isRecording){ startRef.current=Date.now(); timerRef.current=setInterval(()=>setElapsed(Date.now()-startRef.current),200) }
    else{ clearInterval(timerRef.current) }
    return ()=> clearInterval(timerRef.current)
  }, [isRecording])

  async function startRecording(){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = (e)=>{ if(e.data && e.data.size>0) chunksRef.current.push(e.data) }
      mr.onstop = async ()=>{
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecordedBlob(blob)
        setStatus(`Recorded ${(blob.size/1024/1024).toFixed(2)} MB`)
        await saveInterview(blob) // auto-save
      }
      mr.start(1000); mediaRecorderRef.current=mr; setElapsed(0); setIsRecording(true); setStatus('Recording…')
    }catch{ setStatus('Mic permission denied or unsupported.') }
  }

  function stopRecording(){
    if(mediaRecorderRef.current && mediaRecorderRef.current.state!=='inactive'){
      mediaRecorderRef.current.stop(); setIsRecording(false); setStatus('Processing recording…')
    }
  }

  async function saveInterview(blob){
    const audioBlob = blob || recordedBlob; if(!audioBlob) return; setBusy(true)
    try{
      const fd = new FormData()
      fd.append('email', email || 'a@sarva.co')
      fd.append('timestamp', new Date().toISOString())
      fd.append('transcript', transcript || '(no transcript provided)')
      fd.append('audio', audioBlob, 'interview.webm')
      const res = await fetch('/api/save-interview', { method:'POST', body: fd })
      const data = await res.json()
      if(!res.ok) throw new Error(data?.error || 'Upload failed')
      setStatus('Saved! Links emailed.')
      setHistory(h => [{ id: data.id, timestamp: data.timestamp || new Date().toISOString(), audioUrl: data.audioUrl, transcriptUrl: data.transcriptUrl }, ...h])
    }catch(err){ setStatus('Error: '+err.message); alert('Error: '+err.message) }
    finally{ setBusy(false) }
  }

  const canManualSave = !!recordedBlob && !busy

  return (
    <div className="container">
      <header className="header">
        <div className="brand">
          <img src="/logo.svg" alt="AI Interview Assistant logo" />
          <div className="brand-title">
            <h1>AI Interview Assistant</h1>
            <p>Record. Save. Share. Clean and simple.</p>
          </div>
        </div>
        <span className="pill" aria-live="polite">Status: {status}</span>
      </header>

      <div className="card">
        <div className="grid">
          <section>
            <div className="field">
              <label className="label">Interviewer</label>
              <div className="toolbar">
                {!isRecording && <button className="button" onClick={startRecording}>● Start Recording</button>}
                {isRecording && <button className="button danger" onClick={stopRecording}>■ Stop</button>}
                <button className="button ghost" onClick={()=>{ if(botMuted){ setBotMuted(false); speak('Resuming prompts. When you are ready, press record.'); } else { setBotMuted(true); speak('Muting prompts.'); } }}>{botMuted ? 'Unmute Bot' : 'Mute Bot'}</button>
              </div>
              <div className="audio-box" role="region" aria-label="Recording preview">
                {recordedBlob ? (
                  <audio controls src={URL.createObjectURL(recordedBlob)} style={{ width: '100%' }} />
                ) : (
                  <div className="status">Click “Start Recording”. The interviewer will speak prompts to guide you.</div>
                )}
              </div>
              <div className="status" style={{ marginTop: 8 }}>
                <span className="timer" aria-live="polite">{isRecording ? formatTime(elapsed) : (recordedBlob ? 'Saved after stop' : '00:00')}</span>
              </div>
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="transcript" className="label">Transcript notes (optional)</label>
              <textarea id="transcript" className="textarea" placeholder="Paste or type notes here…"
                value={transcript} onChange={e=>setTranscript(e.target.value)} />
            </div>
          </section>

          <aside>
            <div className="field">
              <label className="label">Actions</label>
              <div className="toolbar" style={{ flexDirection:'column', alignItems:'stretch' }}>
                <button className="button secondary" onClick={()=>saveInterview()} disabled={!canManualSave}>
                  ⤴ Save Again (Manual)
                </button>
                <button className="button ghost" onClick={()=>window.location.reload()} disabled={busy}>
                  ↻ Reload App
                </button>
              </div>
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="email" className="label">Logging email:</label>
              <input id="email" className="input" placeholder="you@example.com"
                value={email} onChange={e=>setEmail(e.target.value)} />
              <p className="mini">Used for sending links after each save. Defaults to a@sarva.co.</p>
            </div>
          </aside>
        </div>

        <div className="history">
          <h2>Interview History</h2>
          <div className="history-list">
            {history.length === 0 && <div className="status">No interviews yet.</div>}
            {history.map(item => (
              <div key={item.id} className="history-item">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <div>
                    <strong>{new Date(item.timestamp || Date.now()).toLocaleString()}</strong>
                    <div className="mini">{item.id}</div>
                  </div>
                  <div style={{ display:'flex', gap:12 }}>
                    <a href={item.audioUrl} target="_blank" rel="noreferrer">Audio</a>
                    <a href={item.transcriptUrl} target="_blank" rel="noreferrer">Transcript</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="footer">
          <div className="status">Uploads go to Vercel Blob. Anyone can see history.</div>
          {recordedBlob && (
            <div className="status">
              Size: {(recordedBlob.size/1024/1024).toFixed(2)} MB
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
