import React, { useState, useRef, useEffect } from 'react'

function formatTime(ms){
  const s = Math.floor(ms/1000)
  const m = Math.floor(s/60).toString().padStart(2, '0')
  const r = (s % 60).toString().padStart(2, '0')
  return `${m}:${r}`
}

export default function App(){
  const [email, setEmail] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [status, setStatus] = useState('Ready')
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const startRef = useRef(0)
  const timerRef = useRef(null)

  useEffect(()=>{
    if(isRecording){
      startRef.current = Date.now()
      timerRef.current = setInterval(()=> setElapsed(Date.now() - startRef.current), 200)
    }else{
      clearInterval(timerRef.current)
    }
    return ()=> clearInterval(timerRef.current)
  }, [isRecording])

  async function startRecording(){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      mr.ondataavailable = (e)=>{ if(e.data && e.data.size>0) chunksRef.current.push(e.data) }
      mr.onstop = ()=>{
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecordedBlob(blob)
        setStatus(`Recorded ${(blob.size/1024/1024).toFixed(2)} MB`)
      }
      mr.start(1000)
      mediaRecorderRef.current = mr
      setElapsed(0)
      setIsRecording(true)
      setStatus('Recording…')
    }catch(err){
      setStatus('Mic permission denied or unsupported.')
    }
  }

  function stopRecording(){
    if(mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive'){
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setStatus('Processing recording…')
    }
  }

  function resetAll(){
    setIsRecording(false)
    setRecordedBlob(null)
    setTranscript('')
    setElapsed(0)
    setStatus('Ready')
  }

  async function saveInterview(){
    if(!email){ alert('Please enter your email.'); return }
    if(!recordedBlob){ alert('Record audio first.'); return }
    setBusy(true)
    setStatus('Uploading…')
    try{
      const fd = new FormData()
      fd.append('email', email)
      fd.append('timestamp', new Date().toISOString())
      fd.append('transcript', transcript || '(no transcript provided)')
      fd.append('audio', recordedBlob, 'interview.webm')
      const res = await fetch('/api/save-interview', { method:'POST', body:fd })
      const data = await res.json()
      if(!res.ok) throw new Error(data?.error || 'Upload failed')
      setStatus('Saved! Links emailed.')
      alert('Saved! Check your email for links.')
      console.log('Saved:', data)
    }catch(err){
      setStatus('Error: ' + err.message)
      alert('Error: ' + err.message)
    }finally{
      setBusy(false)
    }
  }

  const canSave = !!email && !!recordedBlob && !busy

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
              <label htmlFor="email" className="label">Your Email</label>
              <input id="email" className="input" placeholder="you@example.com"
                value={email} onChange={e=>setEmail(e.target.value)} />
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label className="label">Recorder</label>
              <div className="toolbar">
                {!isRecording && <button className="button" onClick={startRecording}>● Start Recording</button>}
                {isRecording && <button className="button danger" onClick={stopRecording}>■ Stop</button>}
                <button className="button ghost" onClick={resetAll} disabled={isRecording || busy}>Reset</button>
                <span className="timer" aria-live="polite">{isRecording ? formatTime(elapsed) : (recordedBlob ? 'Ready to save' : '00:00')}</span>
              </div>
              <div className="audio-box" role="region" aria-label="Recording preview">
                {recordedBlob ? (
                  <audio controls src={URL.createObjectURL(recordedBlob)} style={{ width: '100%' }} />
                ) : (
                  <div className="status">No recording yet. Click “Start Recording”.</div>
                )}
              </div>
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="transcript" className="label">Transcript (optional)</label>
              <textarea id="transcript" className="textarea" placeholder="Paste or type transcript here…"
                value={transcript} onChange={e=>setTranscript(e.target.value)} />
            </div>
          </section>

          <aside>
            <div className="field">
              <label className="label">Actions</label>
              <div className="toolbar" style={{ flexDirection:'column', alignItems:'stretch' }}>
                <button className="button secondary" onClick={saveInterview} disabled={!canSave}>
                  ⤴ Save & Email
                </button>
                <button className="button ghost" onClick={()=>window.location.reload()} disabled={busy}>
                  ↻ Reload App
                </button>
              </div>
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <label className="label">Tips</label>
              <div className="card" style={{ padding:12 }}>
                <ul style={{ margin:0, paddingLeft:16, color:'var(--muted)' }}>
                  <li>Use a headset mic for cleaner audio.</li>
                  <li>Keep your browser tab active while recording.</li>
                  <li>Preview before saving to confirm quality.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>

        <div className="footer">
          <div className="status">All uploads are stored to Vercel Blob.</div>
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
