// WebRTC helper for OpenAI Realtime with timeouts and good error messages.
export async function createRealtimeSession({ onRemoteStream }) {
  // 1) Mic first (so browser prompt shows immediately)
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('Microphone blocked. Enable mic access and try again.');
  }

  // 2) Ephemeral session with timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  const sessionRes = await fetch('/api/realtime-session', { method: 'POST', signal: ctrl.signal }).catch(e => {
    if (e.name === 'AbortError') throw new Error('Server took too long to create a Realtime session.');
    throw e;
  });
  clearTimeout(timer);
  if (!sessionRes?.ok) {
    const txt = await sessionRes.text().catch(()=>'');
    throw new Error(txt || 'Failed to create Realtime session (check logs).');
  }
  const session = await sessionRes.json().catch(()=>null);
  const token = session?.client_secret?.value;
  if (!token) throw new Error('Session missing client_secret (set OPENAI_API_KEY in Vercel).');

  // 3) Peer connection
  const pc = new RTCPeerConnection();
  mic.getTracks().forEach(t => pc.addTrack(t, mic));

  // 4) Remote audio
  const remoteStream = new MediaStream();
  pc.ontrack = (e) => {
    const st = e.streams[0];
    if (st) {
      st.getAudioTracks().forEach(tr => remoteStream.addTrack(tr));
      if (onRemoteStream) onRemoteStream(remoteStream);
    }
  };

  // 5) Control channel
  const control = pc.createDataChannel('oai-events');

  // 6) Offer/Answer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const answerSdp = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp
  }).then(r => r.text());
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  // 7) Mixed recorder (user + assistant)
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = ctx.createMediaStreamDestination();
  const micSrc = ctx.createMediaStreamSource(mic); micSrc.connect(dest);
  const remSrc = ctx.createMediaStreamSource(remoteStream); remSrc.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) };

  function startRecording(){ rec.start(1000) }
  function stopAndGetBlob(){ return new Promise(res => { rec.onstop = () => res(new Blob(chunks, { type: 'audio/webm' })); rec.stop(); }) }
  function say(text){
    if (control && control.readyState === 'open') {
      control.send(JSON.stringify({ type:'response.create', response:{ modalities:['audio'], instructions:text, audio:{ voice:'verse' } } }));
    }
  }
  function close(){ try{pc.close()}catch{}; try{mic.getTracks().forEach(t=>t.stop())}catch{}; try{ctx.close()}catch{} }

  return { startRecording, stopAndGetBlob, say, close };
}
