import React, { useState, useRef } from 'react'

export default function App() {
  const [email, setEmail] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [status, setStatus] = useState('Idle')
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      setRecordedBlob(blob)
      setStatus(`Recorded ${(blob.size/1024/1024).toFixed(2)} MB`)
    }
    mr.start(1000)
    mediaRecorderRef.current = mr
    setIsRecording(true)
    setStatus('Recording…')
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setStatus('Processing recording…')
    }
  }

  async function saveInterview() {
    if (!email) { alert('Enter your email first'); return }
    if (!recordedBlob) { alert('Record audio first'); return }
    setStatus('Uploading…')
    const fd = new FormData()
    fd.append('email', email)
    fd.append('timestamp', new Date().toISOString())
    fd.append('transcript', transcript || '(no transcript provided)')
    fd.append('audio', recordedBlob, 'interview.webm')
    const res = await fetch('/api/save-interview', { method: 'POST', body: fd })
    const data = await res.json()
    setStatus('Saved! Links sent via email.')
    console.log('Saved:', data)
  }

  return (
    <div style={{ maxWidth: 760, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>AI Interview Assistant</h1>
      <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" />
      <div>
        {!isRecording && <button onClick={startRecording}>Start</button>}
        {isRecording && <button onClick={stopRecording}>Stop</button>}
        <button onClick={saveInterview}>Save & Email</button>
      </div>
      <p>{status}</p>
      {recordedBlob && <audio controls src={URL.createObjectURL(recordedBlob)} />}
      <textarea value={transcript} onChange={e=>setTranscript(e.target.value)} />
    </div>
  )
}
