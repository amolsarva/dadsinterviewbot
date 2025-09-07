// /api/ask-audio.js — Node.js serverless (Vercel) handler with provider toggle
// Default provider = Google Gemini (text only). OpenAI kept as optional branch.

const DEFAULT_PROVIDER = (process.env.PROVIDER || 'google').toLowerCase();
const OPENAI_URL_RESPONSES = 'https://api.openai.com/v1/responses';
const GEMINI_MODEL_DEFAULT = process.env.GOOGLE_MODEL || 'gemini-1.5-flash';
const OPENAI_MODEL_DEFAULT = process.env.ASK_MODEL || 'gpt-4o';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
    }
    body = body || {};

    const q = req.query || {};
    const provider = (q.provider || body.provider || DEFAULT_PROVIDER).toLowerCase();

    
    if (provider === 'google') {
      const key = process.env.GOOGLE_API_KEY;
      if (!key) return res.status(500).json({ error: 'Missing GOOGLE_API_KEY' });
      const model = GEMINI_MODEL_DEFAULT;

      const textPrompt = (body.text || 'Please transcribe the audio if present, then answer succinctly.').toString().slice(0, 4000);
      const fmt = (body.format || '').toString();
      const hasAudio = !!(body.audio && fmt);
      const mime =
        fmt === 'webm' ? 'audio/webm' :
        fmt === 'wav' ? 'audio/wav' :
        fmt === 'mp3' ? 'audio/mpeg' :
        fmt ? `audio/${fmt}` : undefined;

      const parts = [{ text: textPrompt }];
      if (hasAudio && mime) {
        parts.push({ inlineData: { mimeType: mime, data: body.audio } });
      }

      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: 'user', parts }] })
          }
        );
        const data = await resp.json();
        if (!resp.ok) {
          return res.status(resp.status).json({ error: 'Gemini error', detail: data });
        }
        const partsOut = data?.candidates?.[0]?.content?.parts || [];
        const reply = partsOut.map(p => p.text || '').join(' ').trim();
        return res.status(200).json({ ok: true, provider: 'google', text: reply, raw: data });
      } catch (err) {
        return res.status(500).json({ error: 'Gemini call failed', detail: err?.message || String(err) });
      }
    }
if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
      const text = (body.text || 'ping').toString().slice(0, 4000);
      const model = OPENAI_MODEL_DEFAULT;

      const payload = {
        model,
        input: [{ role: 'user', content: [{ type: 'input_text', text }] }]
      };

      let upstream;
      try {
        upstream = await fetch(OPENAI_URL_RESPONSES, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        return res.status(502).json({ error: 'OpenAI fetch error', detail: e?.message || String(e) });
      }

      const textResp = await upstream.text();
      if (!upstream.ok) {
        return res.status(502).json({ error: 'OpenAI error', status: upstream.status, body: textResp?.slice(0, 500) });
      }

      let data;
      try { data = JSON.parse(textResp); }
      catch { return res.status(502).json({ error: 'Invalid JSON from OpenAI', body: textResp?.slice(0, 400) }); }

      let outText = '';
      try {
        const blocks = data.output?.[0]?.content || data.output || [];
        for (const b of blocks) if (b?.type === 'output_text') outText = (outText + ' ' + (b.text || '')).trim();
      } catch {}

      return res.status(200).json({ ok: true, provider: 'openai', text: outText || '', raw: data });
    }

    return res.status(400).json({ error: 'Unknown provider', provider });
  } catch (err) {
    return res.status(500).json({ error: 'Unhandled server error', detail: err?.message || String(err) });
  }
}
