// WebRTC helper for OpenAI Realtime with timeouts and error surfacing.
export async function createRealtimeSession({ onRemoteStream }) {
  console.time('[RTC] total'); console.info('[RTC] starting session bootstrap');
  // Mic first so permission prompt appears immediately
  let mic;
  try { console.time('[RTC] mic'); mic = await navigator.mediaDevices.getUserMedia({ audio: true }); console.timeEnd('[RTC] mic'); console.info('[RTC] mic tracks', (mic && mic.getTracks && mic.getTracks().length)||0); }
  catch { throw new Error('Microphone blocked. Enable mic access and try again.'); }

  // Ephemeral session with timeout
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try { console.time('[RTC] create-ephemeral'); res = await fetch('/api/realtime-session', { method: 'POST', signal: ctrl.signal }); console.timeEnd('[RTC] create-ephemeral'); }
  catch (e) { clearTimeout(t); if (e.name === 'AbortError') throw new Error('Server took too long to create a Realtime session.'); throw e; }
  clearTimeout(t);

  const txt = await res.text(); console.debug('[RTC] session payload (truncated):', txt.slice(0, 180));
  if (!res.ok) { let msg = 'Failed to create Realtime session.'; try { const j = JSON.parse(txt); msg = j.error || msg; } catch {} throw new Error(msg); }
  const session = JSON.parse(txt);
  const token = session?.client_secret?.value;
  if (!token) throw new Error('Session missing client_secret (check OPENAI_API_KEY in Vercel).');

  // Peer connection
  const pc = new RTCPeerConnection();
  mic.getTracks().forEach(t => pc.addTrack(t, mic));

  // Remote audio
  const remoteStream = new MediaStream();
  pc.ontrack = (e) => {
    const st = e.streams[0];
    if (st) {
      st.getAudioTracks().forEach(tr => remoteStream.addTrack(tr));
      if (onRemoteStream) onRemoteStream(remoteStream);
    }
  };

  // Control channel to send response.create events
  const control = pc.createDataChannel('oai-events');

  // Offer/Answer with OpenAI Realtime
  const offer = await pc.createOffer();
  console.time('[RTC] setLocalDescription'); await pc.setLocalDescription(offer); console.timeEnd('[RTC] setLocalDescription');
  const answerSdp = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp
  }).then(r => r.text());
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  // Mixed recording (user + assistant)
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = ctx.createMediaStreamDestination();
  const micSrc = ctx.createMediaStreamSource(mic); micSrc.connect(dest);
  const remSrc = ctx.createMediaStreamSource(remoteStream); remSrc.connect(dest);

  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) };

  function startRecording(){ rec.start(1000); }
  function stopAndGetBlob(){
    return new Promise(resolve => {
      rec.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
      rec.stop();
    });
  }
  function say(text){
    if (control && control.readyState === 'open') {
      control.send(JSON.stringify({ type:'response.create', response:{ modalities:['audio'], instructions:text, audio:{ voice:'verse' } } }));
    }
  }
  function close(){ try{pc.close()}catch{}; try{mic.getTracks().forEach(t=>t.stop())}catch{}; try{ctx.close()}catch{} }

  return { startRecording, stopAndGetBlob, say, close };
}
