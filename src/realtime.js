// Minimal "speaking bot" placeholder using Web Speech API as a fallback to avoid Realtime WS header issues in browsers.
export function speak(text){
  try{
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 1
    utter.pitch = 1
    speechSynthesis.speak(utter)
  }catch(e){ console.warn('Speech synthesis not available', e) }
}

export function schedulePrompts(lines, intervalMs=45000){
  let i=0
  const id = setInterval(()=>{
    const line = lines[i % lines.length]
    speak(line)
    i++
  }, intervalMs)
  return () => clearInterval(id)
}
