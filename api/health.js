
// /api/health.js — Node.js serverless health probe for both providers
const GEMINI_MODEL_DEFAULT = process.env.GOOGLE_MODEL || 'gemini-1.5-flash';
const OPENAI_MODEL_DEFAULT = process.env.ASK_MODEL || 'gpt-4o';

export default async function handler(req, res) {
  const checks = [];

  // Env presence
  const gKey = process.env.GOOGLE_API_KEY || '';
  const oKey = process.env.OPENAI_API_KEY || '';
  checks.push({ name: 'env.GOOGLE_API_KEY', ok: !!gKey, detail: gKey ? `length=${gKey.length}` : 'missing' });
  checks.push({ name: 'env.OPENAI_API_KEY', ok: !!oKey, detail: oKey ? `length=${oKey.length}` : 'missing' });

  // Gemini basic check
  if (gKey) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL_DEFAULT)}:generateContent?key=${encodeURIComponent(gKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] })
      });
      const ok = r.ok;
      checks.push({ name: 'gemini.generateContent', ok, detail: `status=${r.status}` });
    } catch (e) {
      checks.push({ name: 'gemini.generateContent', ok: false, detail: e?.message || 'fetch error' });
    }
  }

  // OpenAI basic check
  if (oKey) {
    try {
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${oKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_MODEL_DEFAULT, input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }]}] })
      });
      const ok = r.ok;
      checks.push({ name: 'openai.responses', ok, detail: `status=${r.status}` });
    } catch (e) {
      checks.push({ name: 'openai.responses', ok: false, detail: e?.message || 'fetch error' });
    }
  }

  const ok = checks.every(c => c.ok || c.name.startsWith('env.'));
  res.setHeader('Cache-Control','no-store');
  return res.status(ok ? 200 : 500).json({ ok, checks });
}

