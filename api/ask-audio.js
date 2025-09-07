// /api/ask-audio.js — Node.js serverless (Vercel) handler
// Minimal text-only call to /v1/responses to verify env + route wiring.
// Once this returns 200, we can add STT+TTS as separate steps.

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      console.error('[ask-audio] Missing OPENAI_API_KEY');
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    // Parse JSON body (tolerate raw string)
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    body = body || {};

    // For now, reject audio so we can isolate Responses API access.
    if (body.audio || body.format) {
      return res.status(400).json({
        error: "Audio parameters are not enabled in this step.",
        hint: "We're validating /v1/responses access with text-only first. Omit 'audio' and 'format'."
      });
    }

    const userText = (body.text || 'ping').toString().slice(0, 4000);
    const model = process.env.ASK_MODEL || 'gpt-4o'; // you can set ASK_MODEL in Vercel if desired

    const payload = {
      model,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: userText }]
        }
      ]
    };

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      console.error('[ask-audio] upstream non-200', upstream.status, text?.slice(0, 400));
      return res.status(502).json({ error: 'OpenAI error', status: upstream.status, body: text?.slice(0, 500) });
    }

    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      console.error('[ask-audio] JSON parse error', e?.message);
      return res.status(502).json({ error: 'Invalid JSON from OpenAI', body: text?.slice(0, 400) });
    }

    // Extract output text from Responses payload
    let outText = '';
    try {
      const blocks = data.output?.[0]?.content || data.output || [];
      for (const b of blocks) {
        if (b?.type === 'output_text') outText = (outText + ' ' + (b.text || '')).trim();
      }
    } catch {}

    return res.status(200).json({ ok: true, text: outText || '', raw: data });
  } catch (err) {
    console.error('[ask-audio] unhandled error', err?.message || err);
    return res.status(500).json({ error: 'Unhandled server error' });
  }
}