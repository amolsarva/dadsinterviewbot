// WebRTC helper for OpenAI Realtime: connects mic -> model, plays remote audio, records mixed (user+assistant).
export async function createRealtimeSession({ onRemoteStream }) {
  // 1) Get ephemeral token
  const sessionRes = await fetch('/api/realtime-session', { method: 'POST' });
  if (!sessionRes.ok) throw new Error('Failed to create session');
  const session = await sessionRes.json();
  const token = session && session.client_secret && session.client_secret.value;
  if (!token) throw new Error('No client secret from /api/realtime-session');

  // 2) Mic
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });

  // 3) Peer connection
  const pc = new RTCPeerConnection();
  mic.getTracks().forEach(t => pc.addTrack(t, mic));

  // 4) Remote audio stream
  const remoteStream = new MediaStream();
  pc.ontrack = (event) => {
    const st = event.streams[0];
    if (st) {
      st.getAudioTracks().forEach(tr => remoteStream.addTrack(tr));
      if (onRemoteStream) onRemoteStream(remoteStream);
    }
  };

  // 5) Data channel for control messages
  const control = pc.createDataChannel('oai-events');

  // 6) SDP Offer -> Answer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const answerSdp = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp
  }).then(r => r.text());
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  // 7) Mixed recording (local+remote)
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = ctx.createMediaStreamDestination();
  const micSrc = ctx.createMediaStreamSource(mic); micSrc.connect(dest);
  const remSrc = ctx.createMediaStreamSource(remoteStream); remSrc.connect(dest);
  const mixed = dest.stream;
  const rec = new MediaRecorder(mixed, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  function startRecording(){ rec.start(1000); }
  function stopAndGetBlob(){
    return new Promise(resolve => {
      rec.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
      rec.stop();
    });
  }

  function say(text){
    if (control && control.readyState === 'open') {
      control.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['audio'], instructions: text, audio: { voice: 'verse' } }
      }));
    }
  }

  function close(){
    try { pc.close(); } catch {}
    try { mic.getTracks().forEach(t => t.stop()); } catch {}
    try { ctx.close(); } catch {}
  }

  return { startRecording, stopAndGetBlob, say, close };
}
