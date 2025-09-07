import React, { useEffect, useRef, useState } from "react";
import "./app.css";

const fmt = ms => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
};

export default function App() {
  const [provider, setProvider] = useState(localStorage.getItem("provider") || "google");
  useEffect(() => localStorage.setItem("provider", provider), [provider]);

  // user email for send-on-save
  const [email, setEmail] = useState(localStorage.getItem("email") || "");
  useEffect(() => localStorage.setItem("email", email), [email]);

  // turn state: "user" | "assistant"
  const [turn, setTurn] = useState("assistant"); // assistant starts
  const [phase, setPhase] = useState("idle");     // idle|listening|thinking|speaking
  const [status, setStatus] = useState("Loading mic…");
  const [elapsed, setElapsed] = useState(0);
  const [autoMode] = useState(true); // always auto; toggle removed for simplicity

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
  const noiseFloorRef = useRef(0.008); // will be calibrated

  // TTS / barge-in
  const speakingRef = useRef(false);
  const firstRunRef = useRef(true);

  // ---------- INIT ----------
  useEffect(() => {
    (async () => {
      await startMic();
      await calibrateNoise();
      // Assistant greets first
      assistantIntro(() => {
        setTurn("user");
        setPhase("listening");
        setStatus("Your turn — start speaking");
        startVAD();
      });
    })();
    return () => cleanup();
    // eslint-disable-next-line
  }, []);

  function cleanup(stopStream = true) {
    stopVAD();
    stopRecorder(false);
    if (stopStream && mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    cleanupTTS();
  }

  // ---------- MIC + RECORD ----------
  async function startMic() {
    if (mediaStreamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    setStatus("Ready");
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

    const [b64, wavB64] = await Promise.all([
      blobToBase64(blob),
      webmToWavBase64(blob).catch(()=>null)
    ]);

    const resp = await fetch(`/api/ask-audio?provider=${encodeURIComponent(provider)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: b64,
        format: "webm",
        text: BIOGRAPHER_PROMPT
      })
    });

    const json = await resp.json().catch(() => ({}));
    const reply = (json?.text || "").trim();

    // Save the user audio + assistant reply (if blob conversion worked)
    try {
      await fetch("/api/save-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wav: wavB64 || b64, // fallback to original webm if WAV failed
          mime: wavB64 ? "audio/wav" : "audio/webm",
          duration_ms: elapsed,
          provider,
          reply_text: reply,
          email: email || undefined
        })
      });
    } catch {}

    // Speak reply (do not read transcript; it's a new guiding question)
    setTurn("assistant");
    speak(reply, () => {
      setTurn("user");
      setPhase("listening");
      setStatus("Your turn — start speaking");
      startVAD();
    });
  }

  // ---------- VAD + CALIBRATION ----------
  async function calibrateNoise() {
    // sample 800ms of ambient to get baseline RMS
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(mediaStreamRef.current);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);

    let samples = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 800) {
      const arr = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(arr);
      let sum=0;
      for (let i=0;i<arr.length;i++){ const v=(arr[i]-128)/128; sum+=v*v; }
      samples.push(Math.sqrt(sum/arr.length));
      await new Promise(r=>requestAnimationFrame(r));
    }
    samples.sort();
    const median = samples[Math.floor(samples.length*0.5)] || 0.008;
    noiseFloorRef.current = Math.max(0.006, Math.min(0.02, median));
    try { ac.close(); } catch {}
  }

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
    const base = noiseFloorRef.current;
    const startThresh = base * 2.6;    // start when clearly above baseline
    const stopThresh  = base * 1.6;    // stop when it comes back near baseline
    const silenceMs = 800;

    const loop = () => {
      const arr = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(arr);
      let sum = 0;
      for (let i = 0; i < arr.length; i++) { const v = (arr[i]-128)/128; sum += v*v; }
      const rms = Math.sqrt(sum/arr.length);

      if (!speaking && rms > startThresh) {
        speaking = true;
        silenceStartRef.current = null;
        setPhase("listening");
        setStatus("Recording…");
        cleanupTTS(); // barge-in: stop assistant speech
        startRecorder();
      } else if (speaking) {
        if (rms < stopThresh) {
          if (!silenceStartRef.current) silenceStartRef.current = performance.now();
          if (performance.now() - silenceStartRef.current > silenceMs) {
            speaking = false;
            silenceStartRef.current = null;
            stopRecorder(); // triggers send → thinking
          }
        } else {
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
    if (acRef.current) { try { acRef.current.close(); } catch {} acRef.current = null; }
    analyserRef.current = null;
  }

  // ---------- TTS + BARGE-IN ----------
  function assistantIntro(done) {
    const intro = `Hello and welcome to Dad's Interview Bot. I'm your biographer companion.
    We'll have gentle, short conversations to help you recall stories from life.
    When a question finishes, simply answer in your own words—I’ll listen.
    Whenever you pause, I’ll ask a thoughtful follow‑up. Let’s begin.`.replace(/\s+/g,' ').trim();
    speak(intro, done);
  }

  function speak(text, onend) {
    if (!text) { onend?.(); return; }
    if (!("speechSynthesis" in window)) { onend?.(); return; }

    const u = new SpeechSynthesisUtterance(text);
    // mild shaping for clarity without sounding rushed
    u.rate = 0.98; u.pitch = 1.02; u.volume = 1.0;
    speakingRef.current = true;
    setPhase("speaking");
    setStatus("Assistant speaking…");

    u.onend = () => { speakingRef.current = false; onend?.(); };
    u.onerror = () => { speakingRef.current = false; onend?.(); };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function cleanupTTS(){ try { window.speechSynthesis.cancel(); } catch{} speakingRef.current=false; }

  // ---------- Helpers ----------
  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result || "").split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  async function webmToWavBase64(webmBlob){
    const ab = await webmBlob.arrayBuffer();
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await ac.decodeAudioData(ab.slice(0));
    const numChannels = Math.min(2, audio.numberOfChannels);
    const length = audio.length;
    const sampleRate = audio.sampleRate;
    const interleaved = new Float32Array(length * numChannels);
    for (let ch=0; ch<numChannels; ch++){
      audio.copyFromChannel(interleaved.subarray(ch, interleaved.length, numChannels), ch);
    }
    // encode PCM 16-bit WAV
    const wavBuffer = encodeWAV(audio, numChannels, sampleRate);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(wavBuffer)));
    try { ac.close(); } catch{}
    return b64;
  }

  function encodeWAV(audioBuffer, numChannels, sampleRate){
    const length = audioBuffer.length;
    const buffer = new ArrayBuffer(44 + length * 2 * numChannels);
    const view = new DataView(buffer);

    function writeString(view, offset, str){
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + length * 2 * numChannels, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // PCM chunk size
    view.setUint16(offset, 1, true); offset += 2; // PCM
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numChannels * 2, true); offset += 4;
    view.setUint16(offset, numChannels * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2; // bits per sample
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, length * 2 * numChannels, true); offset += 4;

    const tmp = new Float32Array(length);
    for (let ch = 0; ch < numChannels; ch++) {
      audioBuffer.copyFromChannel(tmp, ch);
      // interleave and write as 16-bit PCM
      for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, tmp[i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }
    return buffer;
  }

  // ---------- UI ----------
  return (
    <div className="wrap">
      <header className="hdr">
        <div className="title">Dad&apos;s Interview Bot</div>
        <div className="hdr-actions">
          <input
            className="tiny"
            style={{width:220}}
            placeholder="email to send (optional)"
            value={email}
            onChange={e=>setEmail(e.target.value.trim())}
          />
          <button className="tiny" onClick={() => setProvider(provider === "google" ? "openai" : "google")}>
            Provider: <b>{provider}</b>
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
      </main>
    </div>
  );
}

const BIOGRAPHER_PROMPT = `You are a warm, concise biographer and memoir collaborator.
Your goal is to lead a delightful voice conversation that helps an older adult recall their life.
Do not read back or paraphrase the user's transcript. Instead, ask the next best question.
Keep questions short (under 20 words) and focused, one at a time. Use simple language.
Prefer sensory cues and specific memories (people, places, years) over generalities.
If the user pauses, gently move forward with a follow-up, not a summary.
`;
