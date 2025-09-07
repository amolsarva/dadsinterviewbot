
// /api/health.js — Node.js serverless (Vercel) handler
export default async function handler(req, res) {
  const key = process.env.OPENAI_API_KEY || '';
  const model = process.env.AUDIO_MODEL || 'gpt-4o-audio-preview-2024-12-17';

  const checks = [];
  checks.push({ name: 'env.OPENAI_API_KEY', ok: !!key, detail: key ? `length=${key.length}` : 'missing' });

  let models = { name: 'GET /v1/models', ok: false };
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    models.ok = r.ok;
    models.detail = `status=${r.status}`;
  } catch (e) {
    models.detail = e?.message || 'fetch error';
  }
  checks.push(models);

  let respCheck = { name: 'POST /v1/responses (text only)', ok: false };
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }]}]})
    });
    const t = await r.text();
    respCheck.ok = r.ok;
    respCheck.detail = `status=${r.status} body=${t.slice(0,120)}`;
  } catch (e) {
    respCheck.detail = e?.message || 'fetch error';
  }
  checks.push(respCheck);

  const ok = checks.every(c => c.ok);
  res.setHeader('Cache-Control','no-store');
  return res.status(ok ? 200 : 500).json({ ok, checks });
}
