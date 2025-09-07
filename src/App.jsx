import React, { useEffect, useMemo, useRef, useState } from 'react';
import './app.css';

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export default function App() {
  // URL flags
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1';

  // Provider toggle (persisted)
  const [provider, setProvider] = useState(localStorage.getItem('provider') || 'google');
  useEffect(() => localStorage.setItem('provider', provider), [provider]);

  // UI state machine
  const [phase, setPhase] = useState('idle'); // idle|recording|thinking|playing
  const [status, setStatus] = useState('Ready');
  const [logLines, setLogLines] = useState([]);

  // Recording state
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  // Assistant audio playback
  const audioRef = useRef(null);
  const [speaking, setSpeaking] = useState(false);

  const log = (line) => setLogLines((prev) => [...prev, line]);

  // Modal help
  const [showHelp, setShowHelp] = useState(false);

  // ---- Recording flow ----
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = handleRecordingStopped;

      mediaRecorderRef.current = mr;
      mr.start();

      setPhase('recording');
      setStatus('Recording…');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((t) => t + 100), 100);
      if (debug) log('[REC] started');
    } catch (e) {
      setStatus('Mic error — check permissions');
      if (debug) log('[REC] error: ' + e.message);
    }
  }

  function stopRecording() {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
      setStatus('Thinking…');
      setPhase('thinking');
    } catch (e) {
      if (debug) log('[REC] stop error: ' + e.message);
    }
  }

  async function handleRecordingStopped() {
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const b64 = await blobToBase64(blob);

      if (debug) log(`[ASK] sending ${Math.round(blob.size / 1024)} KB to /api/ask-audio?provider=${provider}`);
      const resp = await fetch(`/api/ask-audio?provider=${encodeURIComponent(provider)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: b64,
          format: 'webm',
          text: 'You are an interviewing assistant. Transcribe my audio and reply with the next question to keep a life interview going.'
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        setPhase('idle');
        setStatus('Ready');
        if (debug) log(`[ASK] error ${resp.status}: ${JSON.stringify(json).slice(0, 240)}`);
        return;
      }

      const replyText = (json.text || '').trim();
      if (debug) log('[ASK] reply: ' + replyText);

      // Speak the reply using browser TTS (simple + free)
      if ('speechSynthesis' in window && replyText) {
        setPhase('playing');
        setStatus('Speaking…');
        setSpeaking(true);
        const utter = new SpeechSynthesisUtterance(replyText);
        utter.onend = () => {
          setSpeaking(false);
          setPhase('idle');
          setStatus('Ready');
        };
        window.speechSynthesis.speak(utter);
      } else {
        // Fallback: show text & stay ready
        setPhase('idle');
        setStatus('Ready');
      }

      // Optional: save turn (stub; server route present in repo)
      try {
        fetch('/api/save-interview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, user_ms: elapsed, reply_text: replyText }),
        });
      } catch {}

    } catch (e) {
      setPhase('idle');
      setStatus('Ready');
      if (debug) log('[ASK] unhandled: ' + e.message);
    }
  }

  // Helpers
  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result || '').split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

  // ---- Primary button behavior ----
  function onPrimary() {
    if (phase === 'idle') startRecording();
    else if (phase === 'recording') stopRecording();
    else if (phase === 'playing') { /* allow Continue to go back to recording */ startRecording(); }
  }

  // ---- Render ----
  return (
    <div className="wrap">
      <header className="hdr">
        <div className="title">Dad&apos;s Interview Bot</div>
        <div className="hdr-actions">
          <button className="tiny" onClick={() => setShowHelp(true)}>Help</button>
          <button className="tiny" onClick={() => setProvider(provider === 'google' ? 'openai' : 'google')}>
            Provider: <b>{provider}</b>
          </button>
        </div>
      </header>

      <main className="panel">
        <div className="status-row">
          {phase === 'recording' ? (
            <div className="glyph recording"><div className="dot">●</div></div>
          ) : phase === 'thinking' ? (
            <div className="glyph thinking"><div className="spinner" /></div>
          ) : phase === 'playing' ? (
            <div className="glyph playing">▶</div>
          ) : (
            <div className="glyph idle">●</div>
          )}
          <div className="status-text">{status}</div>
          {phase === 'recording' ? (
            <div className="timer">{fmtTime(elapsed)}</div>
          ) : null}
        </div>

        <div className="controls">
          <button
            className={`primary ${phase === 'thinking' ? 'disabled' : ''}`}
            disabled={phase === 'thinking'}
            onClick={onPrimary}
          >
            {phase === 'idle' && 'Start'}
            {phase === 'recording' && 'Done'}
            {phase === 'thinking' && 'Thinking…'}
            {phase === 'playing' && 'Continue'}
          </button>
        </div>

        <div className="assist-audio">
          <audio ref={audioRef} controls style={{ width: '100%' }} />
        </div>
      </main>

      {debug && (
        <pre className="log">
{logLines.join('\n')}
        </pre>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function HelpModal({ onClose }) {
  const bullets = [
    'Talk, don’t type — mic-first interviews with real-time AI voice.',
    'Instant responses — powered by your chosen AI provider.',
    'Automatic recording — mixed audio saved securely.',
    'History at your fingertips — browse past sessions in a public archive.',
    'Optional email delivery — send conversations straight to your inbox.',
    'Reliable + private — strong server logging and timeouts keep sessions stable.',
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">What it does</div>
        <ul>
          {bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
        <div style={{ textAlign: 'right' }}>
          <button className="tiny" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
