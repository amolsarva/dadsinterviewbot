export const config = { runtime: 'edge' }

const SYSTEM_PROMPT = `You are a warm, patient biographer helping an older adult remember their life.
Goals: guide a long conversation in short steps; never repeat or paraphrase the user’s words; ask one short, specific, sensory-rich question (≤ 20 words) that either (a) digs deeper on the last detail, (b) moves to a closely related facet (people, place, date), or (c) gracefully shifts to a new chapter if the user signals they wish to.
Keep silence handling patient; do not rush to speak if the user pauses briefly.
Background noise is irrelevant—focus on spoken voice only.
Return a JSON object: {"reply":"...", "transcript":"...", "end_intent":true|false}.`

export default async function handler(req){
  const { searchParams } = new URL(req.url)
  const provider = searchParams.get('provider') || process.env.PROVIDER || 'google'
  const body = await req.json().catch(()=>({}))
  const { audio, format='webm', text } = body

  if (!process.env.GOOGLE_API_KEY){
    return new Response(JSON.stringify({ ok:true, provider, reply:"Who was with you in that room—name one person and what they wore.", transcript:text||"", end_intent:false }), { status:200, headers:{'Content-Type':'application/json'} })
  }

  try{
    const parts = [{ text: SYSTEM_PROMPT }]
    if (audio) parts.push({ inlineData: { mimeType:`audio/${format}`, data: audio } })
    if (text) parts.push({ text })
    parts.push({ text: 'Return JSON: {"reply": "...", "transcript": "...", "end_intent": false}' })
    const model = process.env.GOOGLE_MODEL || 'gemini-1.5-flash'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ role:'user', parts }] })
    })
    const j = await r.json()
    let txt = j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('\n') || ''
    let out = { ok:true, provider:'google', reply: "Tell me about the light in that place—morning sun, lamps, or shadows?", transcript:"", end_intent:false }
    try{
      const t = txt.trim().replace(/^```(json)?/,'').replace(/```$/,'')
      const p = JSON.parse(t)
      out.reply = p.reply || out.reply
      out.transcript = p.transcript || out.transcript
      out.end_intent = !!p.end_intent
    }catch(e){ out.reply = txt || out.reply }
    return new Response(JSON.stringify(out), { status:200, headers:{'Content-Type':'application/json'} })
  }catch(e){
    return new Response(JSON.stringify({ ok:true, provider, reply:"Who else was there with you—first name and one detail about them?", transcript:"", end_intent:false }), { status:200, headers:{'Content-Type':'application/json'} })
  }
}
