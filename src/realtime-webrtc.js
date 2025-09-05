// Minimal (non-placeholder) realtime implementation skeleton
export async function createRealtimeSession({ onRemoteStream }){
  const session = await fetch('/api/realtime-session', { method: 'POST' }).then(r => r.json());
  const token = session?.client_secret?.value; if(!token) throw new Error('No client secret');
  const mic = await navigator.mediaDevices.getUserMedia({ audio:true });
  const pc = new RTCPeerConnection();
  mic.getTracks().forEach(t => pc.addTrack(t, mic));
  const remoteStream = new MediaStream();
  pc.ontrack = (e)=>{ e.streams[0].getAudioTracks().forEach(tr=>remoteStream.addTrack(tr)); if(onRemoteStream) onRemoteStream(remoteStream) };
  const chan = pc.createDataChannel('oai-events');
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  const sdp = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',{method:'POST', headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/sdp'}, body: offer.sdp}).then(r=>r.text());
  await pc.setRemoteDescription({type:'answer', sdp});
  const ctx = new (window.AudioContext||window.webkitAudioContext)(); const dest = ctx.createMediaStreamDestination();
  const micSrc = ctx.createMediaStreamSource(mic); micSrc.connect(dest);
  const remSrc = ctx.createMediaStreamSource(remoteStream); remSrc.connect(dest);
  const mixed = dest.stream; const rec = new MediaRecorder(mixed, { mimeType:'audio/webm;codecs=opus' }); const chunks=[];
  rec.ondataavailable = e=>{ if(e.data?.size) chunks.push(e.data) }
  const startRecording = ()=> rec.start(1000);
  const stopAndGetBlob = ()=> new Promise(res=>{ rec.onstop=()=>res(new Blob(chunks,{type:'audio/webm'})); rec.stop() });
  const say = (text)=>{ if(chan && chan.readyState==='open') chan.send(JSON.stringify({type:'response.create', response:{modalities:['audio'], instructions:text, audio:{ voice:'verse' }}})) }
  const close = ()=>{ pc.close(); mic.getTracks().forEach(t=>t.stop()); try{ctx.close()}catch{} }
  return { startRecording, stopAndGetBlob, say, close };
