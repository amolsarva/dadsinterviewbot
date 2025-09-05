import React, { useRef, useState, useEffect } from 'react'
import { createRealtimeSession } from './realtime-webrtc.js'
export default function App(){
  const [email, setEmail] = useState('a@sarva.co')
  const [isLive, setIsLive] = useState(false)
  const [blob, setBlob] = useState(null)
  const [status, setStatus] = useState('Ready')
  const audioRef = useRef(null); const connRef = useRef(null)
  useEffect(()=>{ fetch('/api/get-history').then(r=>r.json()).then(d=>window._hist=d).catch(()=>{}) },[])
  async function start(){
    setStatus('Connecting…')
    const conn = await createRealtimeSession({ onRemoteStream: s=>{ if(audioRef.current){ audioRef.current.srcObject=s; audioRef.current.play().catch(()=>{}) } } })
    connRef.current = conn; conn.startRecording(); setIsLive(true); conn.say("Welcome to the interview app. We are going to do some interviewing about your history and life. Just press record there and you and I will have a conversation.")
  }
  async function stop(){
    setStatus('Stopping…')
    const b = await connRef.current.stopAndGetBlob(); connRef.current.close(); setIsLive(false); setBlob(b); setStatus('Saving…')
    const fd = new FormData(); fd.append('email', email||'a@sarva.co'); fd.append('timestamp', new Date().toISOString()); fd.append('transcript','(mixed)'); fd.append('audio', b, 'interview.webm')
    await fetch('/api/save-interview', { method:'POST', body: fd }).catch(()=>{}); setStatus('Saved!')
  }
  return (<div><h1>Interview App (Realtime)</h1><div><button onClick={isLive?stop:start}>{isLive?'Stop':'Start Conversation'}</button></div><audio ref={audioRef} autoPlay playsInline/>{blob && <audio controls src={URL.createObjectURL(blob)}/>}
    <div style={{marginTop:12}}><label>Logging email</label><input value={email} onChange={e=>setEmail(e.target.value)} /></div><div>{status}</div></div>)
}
