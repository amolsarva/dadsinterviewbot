function createBandpass(ctx) {
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 250
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3600
  hp.connect(lp)
  return { input: hp, output: lp }
}

function rms(buf) {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

export async function calibrateRMS(seconds = 2.0) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const { input, output } = createBandpass(ctx)
  src.connect(input)
  const an = ctx.createAnalyser()
  an.fftSize = 2048
  output.connect(an)
  const data = new Float32Array(an.fftSize)
  const vals = []
  const end = performance.now() + seconds * 1000
  while (performance.now() < end) {
    an.getFloatTimeDomainData(data)
    vals.push(rms(data))
    await new Promise((r) => setTimeout(r, 50))
  }
  vals.sort((a, b) => a - b)
  const med = vals[Math.floor(vals.length / 2)] || 0.01
  stream.getTracks().forEach((t) => t.stop())
  await ctx.close()
  return med
}

export async function recordUntilSilence(options) {
  const {
    baseline,
    minDurationMs = 1200,
    maxDurationMs = 180000,
    silenceMs = 1600,
    graceMs = 600,
    shouldForceStop = () => false,
    startRatio = 3.0,
    stopRatio = 2.0,
  } = options

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const { input, output } = createBandpass(ctx)
  src.connect(input)
  const an = ctx.createAnalyser()
  an.fftSize = 2048
  output.connect(an)
  const proc = ctx.createScriptProcessor(2048, 1, 1)
  output.connect(proc)
  proc.connect(ctx.destination)
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime })
  const chunks = []
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data)
  }
  let started = false
  let startedAt = 0
  let lastLoud = performance.now()
  let quietStreak = 0
  let loudStreak = 0
  const data = new Float32Array(an.fftSize)

  return await new Promise((resolve) => {
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime })
      const durationMs = Math.max(0, performance.now() - startedAt)
      cleanup()
      resolve({ blob, durationMs })
    }
    proc.onaudioprocess = () => {
      an.getFloatTimeDomainData(data)
      const safeBaseline = baseline > 0.0001 ? baseline : 0.0001
      const level = rms(data) / safeBaseline
      const now = performance.now()
      if (!started) {
        if (level >= startRatio) {
          if (++loudStreak >= 3) {
            started = true
            startedAt = now
            rec.start()
          }
        } else {
          loudStreak = 0
        }
      } else {
        if (level < stopRatio) quietStreak++
        else {
          quietStreak = 0
          lastLoud = now
        }
        const elapsed = now - startedAt
        const silenceElapsed = now - lastLoud
        if (elapsed >= maxDurationMs) rec.stop()
        else if (shouldForceStop() && elapsed >= minDurationMs) rec.stop()
        else if (elapsed >= minDurationMs && quietStreak >= 8 && silenceElapsed >= silenceMs + graceMs) rec.stop()
      }
    }
    function cleanup() {
      try {
        proc.disconnect()
        output.disconnect()
      } catch {}
      try {
        stream.getTracks().forEach((t) => t.stop())
      } catch {}
      try {
        ctx.close()
      } catch {}
    }
  })
}

export async function blobToBase64(blob) {
  return new Promise((res) => {
    const reader = new FileReader()
    reader.onload = () => res(String(reader.result).split(',')[1])
    reader.readAsDataURL(blob)
  })
}
