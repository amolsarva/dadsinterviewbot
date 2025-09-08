export async function calibrateRMS(seconds=1.6){
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  src.connect(analyser)
  const data = new Float32Array(analyser.fftSize)
  const samples = []
  const start = performance.now()
  while (performance.now() - start < seconds*1000) {
    analyser.getFloatTimeDomainData(data)
    const rms = Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length)
    samples.push(rms)
    await new Promise(r=>setTimeout(r,50))
  }
  const sorted = samples.slice().sort((a,b)=>a-b)
  const median = sorted[Math.floor(sorted.length/2)] || 0.02
  stream.getTracks().forEach(t=>t.stop())
  await ctx.close()
  return median
}

export async function recordUntilSilence({baseline, minDurationMs=1200, maxDurationMs=180000, silenceMs=1600, graceMs=600}){
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  src.connect(analyser)
  const processor = ctx.createScriptProcessor(2048, 1, 1)
  src.connect(processor); processor.connect(ctx.destination)
  const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/webm;codecs=opus'
  const rec = new MediaRecorder(stream, { mimeType: mime })
  const chunks = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  let started = false, startedAt = 0, lastLoudTs = performance.now()
  const data = new Float32Array(analyser.fftSize)

  return await new Promise((resolve, reject)=>{
    rec.onstop = ()=>{
      const blob = new Blob(chunks, { type: mime })
      const durationMs = performance.now() - startedAt
      cleanup(); resolve({ blob, durationMs })
    }
    processor.onaudioprocess = () => {
      analyser.getFloatTimeDomainData(data)
      const rms = Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length)
      const level = baseline>0 ? (rms / baseline) : 0
      const now = performance.now()
      if (!started && level >= 3.0) { started = true; startedAt = now; rec.start() }
      if (started) {
        if (level >= 2.0) lastLoudTs = now
        const elapsed = now - startedAt
        const silenceElapsed = now - lastLoudTs
        if (elapsed >= maxDurationMs) rec.stop()
        else if (elapsed >= minDurationMs && silenceElapsed >= (silenceMs + graceMs)) rec.stop()
      }
    }
    function cleanup(){ try{processor.disconnect(); src.disconnect()}catch(e){} try{stream.getTracks().forEach(t=>t.stop())}catch(e){} try{ctx.close()}catch(e){} }
  })
}

export async function blobToBase64(blob){
  return new Promise(res=>{
    const r = new FileReader()
    r.onload = ()=> res(String(r.result).split(',')[1])
    r.readAsDataURL(blob)
  })
}
