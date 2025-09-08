import React, { useEffect, useRef, useState } from 'react'
import { calibrateRMS, recordUntilSilence, blobToBase64 } from './lib/audio'

const PROVIDER_DEFAULT = 'google'
const OPENING = `Hello and welcome to Dad’s Interview Bot. I’m your biographer companion. We’ll have gentle, short conversations to help you recall stories. When a question finishes, just answer in your own words, and when you pause I’ll ask a thoughtful follow-up. Take your time. Let’s begin.`

export default function App(){
  const [state, setState] = useState('assistant:intro')
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem('sessionId') || crypto.randomUUID())
  const [turn, setTurn] = useState(0)
  const [email, setEmail] = useState(() => localStorage.getItem('email') || 'a@sarva.co')
  const [historyOpen, setHistoryOpen] = useState(false)
  const spokenOnceRef = useRef(false)
  const forceStopRef = useRef(false)

  useEffect(()=>{ sessionStorage.setItem('sessionId', sessionId) }, [sessionId])
  useEffect(()=>{ localStorage.setItem('email', email) }, [email])

  useEffect(()=>{
    if (!spokenOnceRef.current) {
      spokenOnceRef.current = true
      speak(OPENING, ()=> { setState('user:listening'); runUserTurn() })
    }
  }, [])

  function speak(text, onend){
    const u = new SpeechSynthesisUtterance(text); u.rate=1; u.pitch=1; u.onend=onend
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); setState('assistant:speaking')
  }

  async function runUserTurn(){
    try{
      setState('user:listening')
      const baseline = await calibrateRMS(2.0)
      const rec = await recordUntilSilence({ baseline, minDurationMs:1200, silenceMs:1600, graceMs:600, shouldForceStop: ()=> forceStopRef.current })
      const b64 = await blobToBase64(rec.blob)
      setState('assistant:thinking')
      const askRes = await fetch('/api/ask-audio?provider='+encodeURIComponent(PROVIDER_DEFAULT), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ audio:b64, format:'webm', sessionId, turn: turn+1 })
      }).then(r=>r.json()).catch(()=>({ reply:"Tell me one small detail you remember from that moment.", transcript:"", end_intent:false }))
      const { reply, transcript, end_intent } = askRes

      const endRegex = /(i[' ]?m done|stop for now|that’s all|i’m finished|we’re done|let’s stop)/i
      const shouldEnd = end_intent === true || (transcript && endRegex.test(transcript))

      const save = await fetch('/api/save-turn', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId, turn: turn+1, wav: b64, mime:'audio/webm', duration_ms: rec.durationMs,
          reply_text: reply, transcript, provider: PROVIDER_DEFAULT, email })
      })
      if (!save.ok) throw new Error('Save turn failed: ' + save.status)

      setTurn(t=>t+1)
      forceStopRef.current = false
      if (shouldEnd) return finalizeSession()
      setTimeout(()=> speak(reply, ()=> runUserTurn()), 300)
    }catch(e){
      console.error(e); alert('There was a problem saving or asking. Check /api/health and env keys.'); setState('idle')
    }
  }

  async function finalizeSession(){
    try{
      window.speechSynthesis.cancel(); setState('assistant:thinking')
      const resp = await fetch('/api/finalize-session', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId, email }) })
      const j = await resp.json().catch(()=>({ ok:false })); if (!resp.ok || !j.ok) throw new Error('Finalize failed')
      setState('idle'); alert(`Session saved & emailed to ${email}`)
    }catch(e){ console.error(e); alert('Finalize failed. Open /api/health to verify env, and ensure at least one /api/save-turn succeeded.'); setState('idle') }
  }

  function startAgain(){ window.speechSynthesis.cancel(); const next=crypto.randomUUID(); setSessionId(next); setTurn(0); setState('assistant:intro'); spokenOnceRef.current=false; speak(OPENING, ()=>{ setState('user:listening'); runUserTurn() }) }

  return (<>
    <header>
      <div className="title">Dad’s Interview Bot <span className="statechip">{state}</span></div>
      <div className="toolbar">
        <input className="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <button className="secondary" onClick={()=>setHistoryOpen(true)}>History</button>
      </div>
    </header>
    <main>
      <div className="panel">
        <div className="layout">
          <div className={'bigglyph ' + (state==='user:listening'?'recording':'')}><div className="dot" /></div>
          <div className="controls">
            <div className="status">{state==='assistant:intro'?'Welcome…':state==='user:listening'?'Recording… take your time.':state==='assistant:thinking'?'Thinking…':state==='assistant:speaking'?'Playing reply…':'Session complete.'}</div>
            <div style={{display:'flex',gap:8}}>
  {state!=='idle' && (
    <button className="secondary" title="Skip the wait and let the assistant speak" onClick={()=>{ forceStopRef.current = true; }}>
      ⏭ Next
    </button>
  )}
</div>
            <div className="helpbar"><span>&nbsp;</span><span>Noise-robust: waits for ~2.2s quiet after speech.</span></div>
          </div>
        </div>
      </div>
      {historyOpen && <History onClose={()=>setHistoryOpen(false)} />}
    </main>
    <button className="fab-health" onClick={()=>window.open('/api/health','_blank')}>Health</button>
  </>)
}

function History({onClose}){
  const [items, setItems] = React.useState([])
  React.useEffect(()=>{ fetch('/api/get-history?page=1&limit=10').then(r=>r.json()).then(setItems).catch(()=>setItems({items:[]})) },[])
  return (<div className="modal" onClick={onClose}><div className="card" onClick={e=>e.stopPropagation()}>
    <div className="head"><b>History</b><button className="ghost" onClick={onClose}>Close</button></div>
    <div className="rows">{(items.items||[]).map(s=>(<div key={s.sessionId}>
      <div><b>{new Date(s.startedAt||Date.now()).toLocaleString()}</b> — turns {s.totals?.turns||0}</div>
      {s.manifestUrl && <div><a className="link" href={s.manifestUrl} target="_blank" rel="noreferrer">View manifest</a></div>}
    </div>))}</div>
  </div></div>)
}
