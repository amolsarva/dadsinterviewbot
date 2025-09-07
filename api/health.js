// /api/health.js
export const runtime = 'edge';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler() {
  const key = process.env.OPENAI_API_KEY;
  const org = process.env.OPENAI_ORG || null;
  const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';

  const checks = [];

  // Check env presence (length only, not value)
  checks.push({ name: 'env.OPENAI_API_KEY', ok: !!key, detail: key ? `length=${key.length}` : 'missing' });
  if (org) checks.push({ name: 'env.OPENAI_ORG', ok: true, detail: org });

  // Probe basic API reachability (models list)
  let reach = { name: 'GET /v1/models', ok: false };
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    reach.ok = r.ok;
    reach.detail = `status=${r.status}`;
  } catch (e) {
    reach.detail = e?.message || 'fetch error';
  }
  checks.push(reach);

  // Probe realtime session create (same as /api/realtime-session but shorter timeout)
  let rt = { name: 'POST /v1/realtime/sessions', ok: false };
  try {
    const controller = new AbortController();
    const to = setTimeout(()=>controller.abort(), 6000);
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify({ model, voice:'verse', modalities:['audio','text'] }),
      signal: controller.signal
    });
    clearTimeout(to);
    const text = await r.text();
    rt.ok = r.ok;
    rt.detail = `status=${r.status} body=${text.slice(0,180)}`;
  } catch (e) {
    rt.detail = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch error');
  }
  checks.push(rt);

  const allOk = checks.every(c => c.ok);
  return json({ ok: allOk, checks });
}
