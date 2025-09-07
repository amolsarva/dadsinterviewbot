// /api/ask-audio.js
export const runtime = 'edge';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json({ error: 'Missing OPENAI_API_KEY' }, 500);

  const body = await req.json().catch(()=>null);
  if (!body || !body.audio || !body.format) {
    return json({ error: 'Missing audio payload' }, 400);
  }
  const model = process.env.AUDIO_MODEL || 'gpt-4o-audio-preview-2024-12-17';
  const voice = process.env.AUDIO_VOICE || 'verse';
  const userText = (body.text || '').slice(0, 4000);
  const audioB64 = body.audio; // base64 string
  const fmt = body.format; // e.g. 'webm'

  const payload = {
    model,
    modalities: ['text','audio'],
    audio: { voice, format: 'mp3' },
    input: [
      {
        role: 'user',
        content: [
          ...(userText ? [{ type: 'input_text', text: userText }] : []),
          { type: 'input_audio', audio: { data: audioB64, format: fmt } }
        ]
      }
    ]
  };

  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json({ error: 'Upstream error', detail: e?.message || String(e) }, 502);
  }

  const text = await resp.text();
  if (!resp.ok) {
    return json({ error: 'OpenAI error', status: resp.status, body: text?.slice(0, 500) }, 502);
  }

  // Expecting { output: [ { content: [ { type:'output_audio', audio: { data, format } }, { type:'output_text', text } ] } ] } shape
  let data;
  try { data = JSON.parse(text); } catch { return json({ error:'Invalid JSON from OpenAI', body: text?.slice(0,400) }, 502); }

  // Try to find audio + text
  let outAudioB64 = null, outFmt = 'mp3', outText = '';
  try {
    const blocks = data.output?.[0]?.content || data.output || [];
    for (const b of blocks) {
      if (b?.type === 'output_audio') { outAudioB64 = b.audio?.data || outAudioB64; outFmt = b.audio?.format || outFmt; }
      if (b?.type === 'output_text') { outText = (outText + ' ' + (b.text||'')).trim(); }
    }
  } catch {}

  if (!outAudioB64) {
    // Some responses place audio elsewhere; fallback to direct fields if present
    outAudioB64 = data?.audio?.data || null;
    outFmt = data?.audio?.format || outFmt;
  }

  return json({ ok:true, text: outText || '', audio: outAudioB64, format: outFmt });
}
