// src/smoke-tests.js
export async function runSmokeTests() {
  const results = [];
  const log = (ok, name, detail) => {
    const prefix = ok ? "[SMOKE ✅]" : "[SMOKE ❌]";
    const msg = `${prefix} ${name} — ${detail || ""}`.trim();
    (console.info || console.log)(msg);
    results.push({ ok, name, detail });
  };

  // Test 0: Browser capabilities
  try {
    const hasRTC = !!(window.RTCPeerConnection);
    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasAudioCtx = !!(window.AudioContext || window.webkitAudioContext);
    if (hasRTC && hasMedia && hasAudioCtx) log(true, "Browser capabilities", "WebRTC, mic, AudioContext present");
    else log(false, "Browser capabilities", `RTC:${hasRTC} mic:${hasMedia} audioCtx:${hasAudioCtx}`);
  } catch (e) { log(false, "Browser capabilities", e.message); }

  // Test 1: Microphone permission & capture (quick probe)
  try {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const st = await navigator.permissions.query({ name: 'microphone' });
        console.log("[SMOKE] mic permission:", st.state);
      } catch {}
    }
    const t0 = performance.now();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const dt = Math.round(performance.now() - t0);
    stream.getTracks().forEach(t => t.stop());
    log(true, "Microphone access", `granted in ~${dt}ms`);
  } catch (e) { log(false, "Microphone access", e.message); }

  // Test 2: /api/get-history reachable
  try {
    const t0 = performance.now();
    const res = await fetch('/api/get-history', { method: 'GET' });
    const dt = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    log(true, "History endpoint", `ok in ~${dt}ms, items: ${(data?.items||[]).length||0}`);
  } catch (e) { log(false, "History endpoint", e.message); }

  // Test 3: /api/realtime-session reachable (GET allowed)
  // Test 3b: /api/ask-audio reachable with tiny silent payload
  try {
    // 200ms of silence WebM may not be trivial to synthesize here; just hit endpoint with fake base64 to assert error handling path
    const fake = btoa('fake');
    const r = await fetch('/api/ask-audio', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ audio: fake, format:'webm' }) });
    if (r.status===502 || r.status===200) {
      log(true, "Ask-audio endpoint", "reachable");
    } else {
      log(false, "Ask-audio endpoint", "status "+r.status);
    }
  } catch (e) { log(false, "Ask-audio endpoint", e.message); }
  try {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('/api/realtime-session', { method: 'GET', signal: ctrl.signal });
    clearTimeout(timeout);
    const dt = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let ok = false;
    try { const j = JSON.parse(text); ok = !!(j && j.client_secret && j.client_secret.value); } catch {}
    log(ok, "Realtime session creation", ok ? `ok in ~${dt}ms` : "unexpected response format");
  } catch (e) {
    log(false, "Realtime session creation", e.name === 'AbortError' ? "timeout" : e.message);
    console.warn("[SMOKE hint] Check OPENAI_API_KEY env var and network egress to OpenAI Realtime.");
  }

  // Test 4: AudioContext resume
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    await ctx.resume();
    log(ctx.state === 'running', "AudioContext", ctx.state);
    await ctx.close();
  } catch (e) { log(false, "AudioContext", e.message); }

  console.log("[SMOKE] Completed", results);
  return results;
}
