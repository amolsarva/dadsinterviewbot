import React, { useEffect, useRef, useState } from 'react'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from './lib/audio'

const PROVIDER_DEFAULT = 'google'
const OPENING = `Hello and welcome to Dad’s Interview Bot. I’m your biographer companion. We’ll have gentle, short conversations to help you recall stories. When a question finishes, just answer in your own words, and when you pause I’ll ask a thoughtful follow-up. Take your time. Let’s begin.`

export default function App(){
  const [state, setState] = useState('assistant:intro')
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem('sessionId') || crypto.randomUUID())
  const [turn, setTurn] = useState(0)
  const [email, setEmail] = useState(() => localStorage.getItem('email') || 'a@sarva.co')
  const [provider, setProvider] = useState(PROVIDER_DEFAULT)
  const [historyOpen, setHistoryOpen] = useState(false)
  const spokenOnceRef = useRef(false)

  useEffect(()=>{ sessionStorage.setItem('sessionId', sessionId) }, [sessionId])
  useEffect(()=>{ localStorage.setItem('email', email) }, [email])

  useEffect(()=>{
    if (!spokenOnceRef.current) {
      spokenOnceRef.current = true
      speak(OPENING, ()=> {
        setState('user:listening')
        runUserTurn()
      })
    }
  }, [])

  function speak(text, onend){
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1; u.pitch = 1
    u.onend = onend
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    setState('assistant:speaking')
  }

  async function runUserTurn(){
    try{
      setState('user:listening')
      const baseline = await calibrateRMS(1.6)
      const rec = await recordUntilSilence({ baseline, minDurationMs:1200, silenceMs:1600, graceMs:600 })
      const b64 = await blobToBase64(rec.blob)
      setState('assistant:thinking')
      const askRes = await fetch('/api/ask-audio?provider='+encodeURIComponent(provider), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ audio:b64, format:'webm', sessionId, turn: turn+1 })
      }).then(r=>r.json())
      const { reply, transcript, end_intent } = askRes

      const endRegex = /(i[' ]?m done|stop for now|that’s all|i’m finished|we’re done|let’s stop)/i
      const shouldEnd = end_intent === true || (transcript && endRegex.test(transcript))

      await fetch('/api/save-turn', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          sessionId, turn: turn+1, wav: b64, mime:'audio/webm', duration_ms: rec.durationMs,
          reply_text: reply, transcript, provider, email
        })
      })
      setTurn(t=>t+1)
      if (shouldEnd) return finalizeSession()
      speak(reply, ()=> runUserTurn())
    }catch(e){
      console.error(e)
      alert('Microphone or processing error. Grant mic permission and retry.')
      setState('idle')
    }
  }

  async function finalizeSession(){
    try{
      window.speechSynthesis.cancel()
      setState('assistant:thinking')
      const j = await fetch('/api/finalize-session', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId })
      }).then(r=>r.json())
      setState('idle')
      alert(`Session saved & emailed to ${email}`)
    }catch(e){
      console.error(e)
      setState('idle')
    }
  }

  function startAgain(){
    window.speechSynthesis.cancel()
    const next = crypto.randomUUID()
    setSessionId(next)
    setTurn(0)
    setState('assistant:intro')
    spokenOnceRef.current = false
    speak(OPENING, ()=>{ setState('user:listening'); runUserTurn() })
  }

  return (
    <>
      <header>
        <div className="title">Dad’s Interview Bot <span className="statechip">{state}</span></div>
        <div className="toolbar">
          <input className="email" value={email} onChange={e=>setEmail(e.target.value)} />
          {state!=='idle' ? (
            <button onClick={finalizeSession}>Done</button>
          ) : (
            <button onClick={startAgain}>Start Again</button>
          )}
          <button className="secondary" onClick={()=>setHistoryOpen(true)}>History</button>
        </div>
      </header>
      <main>
        <div className="panel">
          <div className="row">
            <div className={'bigglyph ' + (state==='user:listening'?'recording':'')}><div className="dot" /></div>
            <div className="status">
              {state==='assistant:intro' && 'Welcome…'}
              {state==='user:listening' && 'Recording… take your time.'}
              {state==='assistant:thinking' && 'Thinking…'}
              {state==='assistant:speaking' && 'Playing reply…'}
              {state==='idle' && 'Session complete.'}
            </div>
          </div>
        </div>
        {historyOpen && <History onClose={()=>setHistoryOpen(false)} />}
      </main>
    </>
  )
}

function History({onClose}){
  const [items, setItems] = React.useState([])
  useEffect(()=>{ fetch('/api/get-history?page=1&limit=10').then(r=>r.json()).then(setItems) },[])
  return (
    <div className="panel" style={{position:'fixed', right:16, bottom:16, maxWidth:520, maxHeight:'70vh', overflow:'auto', boxShadow:'0 10px 30px rgba(0,0,0,.1)'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <b>History</b>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <div className="history">
        {(items.items||[]).map(s=>(
          <div key={s.sessionId} style={{padding:'8px 0', borderBottom:'1px solid #eee'}}>
            <div><b>{new Date(s.startedAt||Date.now()).toLocaleString()}</b> — turns {s.totals?.turns||0}</div>
            {s.manifestUrl && <div><a className="link" href={s.manifestUrl} target="_blank" rel="noreferrer">View manifest</a></div>}
          </div>
        ))}
      </div>
    </div>
  )
}
