function createBandpass(ctx){
  const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value = 250; hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 3600; lp.Q.value = 0.7;
  hp.connect(lp)
  return { input: hp, output: lp }
}

function rmsOf(buf){
  let s=0; for(let i=0;i<buf.length;i++){ const v = buf[i]; s += v*v } return Math.sqrt(s/buf.length)
}

export async function calibrateRMS(seconds=2.0){
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const { input, output } = createBandpass(ctx)
  src.connect(input)
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048
  output.connect(analyser)
  const data = new Float32Array(analyser.fftSize)
  const samples = []
  const endAt = performance.now() + seconds*1000
  while (performance.now() < endAt){
    analyser.getFloatTimeDomainData(data)
    samples.push(rmsOf(data))
    await new Promise(r=>setTimeout(r,50))
  }
  const sorted = samples.slice().sort((a,b)=>a-b)
  const median = sorted[Math.floor(sorted.length*0.5)] || 0.01
  stream.getTracks().forEach(t=>t.stop()); await ctx.close()
  return median
}

export async function recordUntilSilence({baseline, minDurationMs=1200, maxDurationMs=180000, silenceMs=1600, graceMs=600}){
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const { input, output } = createBandpass(ctx)
  src.connect(input)
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048
  output.connect(analyser)

  const processor = ctx.createScriptProcessor(2048, 1, 1)
  output.connect(processor); processor.connect(ctx.destination)

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime })
  const chunks = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }

  let started = false, startedAt = 0, lastLoudTs = performance.now()
  const data = new Float32Array(analyser.fftSize)
  let quietStreak = 0, loudStreak = 0

  return await new Promise((resolve)=>{
    rec.onstop = ()=>{
      const blob = new Blob(chunks, { type: mime })
      const durationMs = Math.max(0, performance.now() - startedAt)
      cleanup(); resolve({ blob, durationMs })
    }
    processor.onaudioprocess = () => {
      analyser.getFloatTimeDomainData(data)
      const rms = rmsOf(data)
      const level = baseline>0 ? (rms / baseline) : 0
      const now = performance.now()
      if (!started){
        if (level >= 3.0){ loudStreak++; if (loudStreak >= 3){ started = true; startedAt = now; rec.start() } }
        else { loudStreak = 0 }
      }
      if (started){
        if (level < 2.0){ quietStreak++ } else { quietStreak = 0; lastLoudTs = now }
        const elapsed = now - startedAt
        const silenceElapsed = now - lastLoudTs
        if (elapsed >= maxDurationMs) rec.stop()
        else if (elapsed >= minDurationMs && quietStreak >= 8 && silenceElapsed >= (silenceMs + graceMs)) rec.stop()
      }
    }
    function cleanup(){ try{processor.disconnect(); output.disconnect()}catch(e){} try{stream.getTracks().forEach(t=>t.stop())}catch(e){} try{ctx.close()}catch(e){} }
  })
}

export async function blobToBase64(blob){
  return new Promise(res=>{
    const r = new FileReader()
    r.onload = ()=> res(String(r.result).split(',')[1])
    r.readAsDataURL(blob)
  })
}
