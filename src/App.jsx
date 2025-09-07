import React, { useEffect, useRef, useState } from "react";
import "./app.css";

const fmt = ms => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
};

export default function App() {
  const [provider, setProvider] = useState(localStorage.getItem("provider") || "google");
  useEffect(() => localStorage.setItem("provider", provider), [provider]);

  // turn state: "user" | "assistant"
  const [turn, setTurn] = useState("user");
  const [phase, setPhase] = useState("idle");       // idle|listening|thinking|speaking
  const [status, setStatus] = useState("Ready");
  const [elapsed, setElapsed] = useState(0);
  const [autoMode, setAutoMode] = useState(true);   // toggle if you ever want PTT fallback

  // audio pipeline refs
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  // VAD refs
  const acRef = useRef(null);
  const analyserRef = useRef(null);
  const vadLoopRef = useRef(null);
  const silenceStartRef = useRef(null);

  // TTS / barge-in
  const speakingRef = useRef(false);

  const log = (...a) => { /* optional: console.log("[UI]", ...a); */ };

  // ---------- INIT ----------
  useEffect(() => {
    if (autoMode) bootListening();
    return () => cleanup();
    // eslint-disable-next-line
  }, [autoMode]);

  async function bootListening() {
    cleanupTTS(); // in case
    await startMic();
    startVAD();
    setTurn("user");
    setPhase("listening");
    setStatus("Your turn — start speaking");
  }

  function cleanup(stopStream = true) {
    stopVAD();
    stopRecorder(false);
    if (stopStream && mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }

  // ---------- MIC + RECORD ----------
  async function startMic() {
    if (mediaStreamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
  }

  function startRecorder() {
    if (!mediaStreamRef.current) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") return;

    chunksRef.current = [];
    const mr = new MediaRecorder(mediaStreamRef.current, { mimeType: "audio/webm" });
    mr.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    mr.onstop = onRecorderStopped;
    mediaRecorderRef.current = mr;

    mr.start();
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(t => t + 100), 100);
    log("recorder started");
  }

  function stopRecorder(triggerStopped = true) {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!triggerStopped) mediaRecorderRef.current = null;
  }

  async function onRecorderStopped() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    setPhase("thinking");
    setStatus("Thinking…");
    stopVAD();

    const b64 = await blobToBase64(blob);
    const resp = await fetch(`/api/ask-audio?provider=${encodeURIComponent(provider)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: b64,
        format: "webm",
        text: "You are an interviewing assistant. Transcribe my audio and reply with the next question to keep a life interview going."
      })
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json?.ok) {
      setTurn("user"); setPhase("listening"); setStatus("Your turn — start speaking");
      startVAD();
      return;
    }

    const reply = (json.text || "").trim();
    setTurn("assistant");
    speak(reply, () => {
      // after speaking finishes, return to user turn
      setTurn("user");
      setPhase("listening");
      setStatus("Your turn — start speaking");
      startVAD();
    });
  }

  // ---------- VAD ----------
  function startVAD() {
    if (!mediaStreamRef.current) return;
    if (acRef.current) stopVAD();

    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(mediaStreamRef.current);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);

    acRef.current = ac;
    analyserRef.current = analyser;

    let speaking = false;
    const silenceMs = 650;           // how long of silence ends the utterance
    const startThresh = 0.015;       // RMS to consider speech started
    const stopThresh = 0.009;        // RMS below which we begin silence window

    const loop = () => {
      const arr = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(arr);
      // compute rms from time-domain samples around 128 midline
      let sum = 0;
      for (let i = 0; i < arr.length; i++) {
        const v = (arr[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / arr.length);

      if (!speaking && rms > startThresh) {
        // speech starts
        speaking = true;
        silenceStartRef.current = null;
        setPhase("listening");
        setStatus("Recording…");
        startRecorder();
      } else if (speaking) {
        if (rms < stopThresh) {
          // possible silence
          if (!silenceStartRef.current) silenceStartRef.current = performance.now();
          const dur = performance.now() - silenceStartRef.current;
          if (dur > silenceMs) {
            speaking = false;
            silenceStartRef.current = null;
            stopRecorder(); // triggers send → thinking
          }
        } else {
          // reset silence window while talking
          silenceStartRef.current = null;
        }
      }

      vadLoopRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  function stopVAD() {
    if (vadLoopRef.current) cancelAnimationFrame(vadLoopRef.current);
    vadLoopRef.current = null;
    if (acRef.current) {
      try { acRef.current.close(); } catch {}
      acRef.current = null;
    }
    analyserRef.current = null;
  }

  // ---------- TTS + BARGE-IN ----------
  function speak(text, onend) {
    if (!text) { onend?.(); return; }
    if (!("speechSynthesis" in window)) { onend?.(); return; }

    // allow barge-in: if user starts talking, cancel TTS
    startVAD();
    // NOTE: our VAD loop will notice RMS > threshold and stop TTS below:
    const onUserStart = () => {
      // This is handled indirectly by VAD starting a new recording;
      // we still cancel TTS to avoid overlap.
      cleanupTTS();
    };

    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
    speakingRef.current = true;
    setPhase("speaking");
    setStatus("Assistant speaking…");

    u.onend = () => {
      speakingRef.current = false;
      onend?.();
    };
    u.onerror = () => {
      speakingRef.current = false;
      onend?.();
    };

    window.speechSynthesis.cancel(); // clear queue
    window.speechSynthesis.speak(u);

    // Simple barge-in heuristic: if we detect we began recording again, cancel TTS.
    const check = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording" && speakingRef.current) {
        cleanupTTS();
      }
      if (speakingRef.current) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  function cleanupTTS() {
    try { window.speechSynthesis.cancel(); } catch {}
    speakingRef.current = false;
  }

  // ---------- Helpers ----------
  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result || "").split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  // ---------- UI ----------
  return (
    <div className="wrap">
      <header className="hdr">
        <div className="title">Dad&apos;s Interview Bot</div>
        <div className="hdr-actions">
          {/* <button className="tiny" onClick={() => alert('Help coming soon')}>Help</button> */}
          <button className="tiny" onClick={() => setProvider(provider === "google" ? "openai" : "google")}>
            Provider: <b>{provider}</b>
          </button>
          <button className="tiny" onClick={() => setAutoMode(!autoMode)}>
            Mode: <b>{autoMode ? "Auto" : "PTT"}</b>
          </button>
        </div>
      </header>

      <main className="panel">
        <div className="turn-chip" data-turn={turn}>
          {turn === "user" ? "Your turn" : "Assistant"}
        </div>

        <div className="status-row">
          {phase === "thinking" ? (
            <div className="glyph thinking"><div className="spinner" /></div>
          ) : phase === "speaking" ? (
            <div className="glyph playing">▶</div>
          ) : phase === "listening" ? (
            <div className="glyph recording"><div className="dot">●</div></div>
          ) : (
            <div className="glyph idle">●</div>
          )}

          <div className="status-text">{status}</div>
          {phase === "listening" ? <div className="timer">{fmt(elapsed)}</div> : null}
        </div>

        {!autoMode && (
          <div className="controls">
            {phase !== "listening" ? (
              <button className="primary" onClick={() => { setTurn("user"); setPhase("listening"); setStatus("Recording…"); startRecorder(); startVAD(); }}>
                Start
              </button>
            ) : (
              <button className="primary" onClick={() => stopRecorder()}>
                Done
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}