// /api/realtime-session.js
export const runtime = 'edge';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req) {
  // GET allowed for debugging in a browser tab
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  const key = process.env.OPENAI_API_KEY;
  const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
  const voice = process.env.REALTIME_VOICE || 'verse';
  const org = process.env.OPENAI_ORG || undefined;

  if (!key) {
    console.error('[realtime-session] Missing OPENAI_API_KEY');
    return json({ error: 'Missing OPENAI_API_KEY on server' }, 500);
  }

  const url = (process.env.OPENAI_BASE_URL || 'https://api.openai.com') + '/v1/realtime/sessions';

  // Build request payload
  const payload = { model, voice, modalities: ['audio','text'] };
  const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'realtime=v1',
  };
  if (org) headers['OpenAI-Organization'] = org;

  // Add explicit timeout so the edge function never hangs silently
  const controller = new AbortController();
  const timeoutMs = 8000;
  const t0 = Date.now();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  console.log('[realtime-session] creating ephemeral session ->', url, payload);

  let resp, text;
  try {
    resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    text = await resp.text();
  } catch (e) {
    const dt = Date.now() - t0;
    const err = e?.name === 'AbortError' ? `upstream timeout after ${dt}ms` : (e?.message || 'fetch failed');
    console.error('[realtime-session] fetch error:', err);
    clearTimeout(to);
    return json({ error: 'Upstream fetch error', detail: err, elapsedMs: dt }, 504);
  }
  clearTimeout(to);

  const dt = Date.now() - t0;
  console.log('[realtime-session] upstream status', resp.status, `in ${dt}ms`);

  if (!resp.ok) {
    console.error('[realtime-session] upstream non-200', resp.status, text?.slice(0, 400));
    return json({ error: 'OpenAI Realtime error', status: resp.status, body: text, elapsedMs: dt }, 502);
  }

  try {
    const data = JSON.parse(text);
    // Return trimmed payload to browser
    return json({ client_secret: data.client_secret, model: data.model, created: data.created, elapsedMs: dt }, 200);
  } catch (e) {
    console.error('[realtime-session] JSON parse error', e?.message, text?.slice(0, 200));
    return json({ error: 'Invalid JSON from OpenAI', body: text?.slice(0, 400), elapsedMs: dt }, 502);
  }
}
