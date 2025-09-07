
// /api/ask-audio.js  — Node.js serverless (Vercel) handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('[ask-audio] Missing OPENAI_API_KEY');
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  if (!body || !body.audio || !body.format) {
    return res.status(400).json({ error: 'Missing audio payload' });
  }

  const model = process.env.AUDIO_MODEL || 'gpt-4o-audio-preview-2024-12-17';
  const voice = process.env.AUDIO_VOICE || 'verse';
  const userText = (body.text || '').slice(0, 4000);
  const audioB64 = body.audio;
  const fmt = body.format;

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

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('[ask-audio] fetch error', e?.message || e);
    return res.status(502).json({ error: 'Upstream error', detail: e?.message || String(e) });
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return res.status(502).json({ error: 'OpenAI error', status: upstream.status, body: text?.slice(0,500) });
  }

  let data;
  try { data = JSON.parse(text); }
  catch(e) { return res.status(502).json({ error: 'Invalid JSON from OpenAI', body: text?.slice(0,400) }); }

  let outAudioB64 = null, outFmt = 'mp3', outText = '';
  try {
    const blocks = data.output?.[0]?.content || data.output || [];
    for (const b of blocks) {
      if (b?.type === 'output_audio') { outAudioB64 = b.audio?.data || outAudioB64; outFmt = b.audio?.format || outFmt; }
      if (b?.type === 'output_text') { outText = (outText + ' ' + (b.text||'')).trim(); }
    }
  } catch {}

  if (!outAudioB64) {
    outAudioB64 = data?.audio?.data || null;
    outFmt = data?.audio?.format || outFmt;
  }

  return res.status(200).json({ ok: true, text: outText || '', audio: outAudioB64, format: outFmt });
}
