function createBandpass(ctx){ const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=250; const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=3600; hp.connect(lp); return {input:hp, output:lp} }
function rms(buf){ let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i]; return Math.sqrt(s/buf.length) }

export async function calibrateRMS(seconds=2.0){
  const stream = await navigator.mediaDevices.getUserMedia({audio:true})
  const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const {input,output}=createBandpass(ctx); src.connect(input)
  const an = ctx.createAnalyser(); an.fftSize=2048; output.connect(an)
  const data = new Float32Array(an.fftSize); const vals=[]; const end=performance.now()+seconds*1000
  while(performance.now()<end){ an.getFloatTimeDomainData(data); vals.push(rms(data)); await new Promise(r=>setTimeout(r,50)) }
  vals.sort((a,b)=>a-b); const med = vals[Math.floor(vals.length/2)]||0.01
  stream.getTracks().forEach(t=>t.stop()); await ctx.close(); return med
}

export async function recordUntilSilence({baseline, minDurationMs=1200, maxDurationMs=180000, silenceMs=1600, graceMs=600, shouldForceStop=()=>false, maxWaitMs=5000}){
  const stream = await navigator.mediaDevices.getUserMedia({audio:true})
  const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const {input,output}=createBandpass(ctx); src.connect(input)
  const an = ctx.createAnalyser(); an.fftSize=2048; output.connect(an)
  const proc = ctx.createScriptProcessor(2048,1,1); output.connect(proc); proc.connect(ctx.destination)
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm'
  const rec = new MediaRecorder(stream,{mimeType:mime}); const chunks=[]; rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)}
  let started=false, startedAt=0, lastLoud=performance.now(), quietStreak=0, loudStreak=0
  const createdAt=performance.now()
  let resolved=false
  const data = new Float32Array(an.fftSize)
  return await new Promise((resolve)=>{
    rec.onstop=()=>{ if(resolved) return; resolved=true; const blob=new Blob(chunks,{type:mime}); const durationMs=started?Math.max(0,performance.now()-startedAt):0; cleanup(); resolve({blob,durationMs,mimeType:mime}) }
    proc.onaudioprocess=()=>{
      if(resolved) return
      an.getFloatTimeDomainData(data); const level = baseline>0 ? rms(data)/baseline : rms(data); const now = performance.now()
      if(!started){
        if(shouldForceStop()){ resolved=true; cleanup(); resolve({blob:new Blob([], {type:mime}), durationMs:0, mimeType:mime}); return }
        if(level>=3.0){ if(++loudStreak>=3){ started=true; startedAt=now; lastLoud=now; rec.start() } }
        else{
          loudStreak=0
          if(maxWaitMs && now-createdAt>=maxWaitMs){ started=true; startedAt=now; lastLoud=now; rec.start() }
        }
        return
      }
      const elapsed=now-startedAt
      if(shouldForceStop()){ if(elapsed>=Math.min(minDurationMs,400)) rec.stop(); return }
      if(level<2.0) quietStreak++; else { quietStreak=0; lastLoud=now }
      const silenceElapsed=now-lastLoud
      if(elapsed>=maxDurationMs) rec.stop()
      else if(elapsed>=minDurationMs && quietStreak>=8 && silenceElapsed>=(silenceMs+graceMs)) rec.stop()
    }
    function cleanup(){ try{proc.disconnect(); output.disconnect()}catch{} try{stream.getTracks().forEach(t=>t.stop())}catch{} try{ctx.close()}catch{} }
  })
}

export async function blobToBase64(blob){
  return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]); r.readAsDataURL(blob) })
}
