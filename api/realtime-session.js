// /api/realtime-session.js
export const runtime = 'edge';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req) {
  // GET allowed temporarily for debugging in a browser tab
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('[realtime-session] Missing OPENAI_API_KEY');
    return json({ error: 'Missing OPENAI_API_KEY (set in Vercel env vars)' }, 500);
  }

  const body = {
    model: 'gpt-4o-realtime-preview',
    voice: 'verse',
    instructions: `You are an empathetic, curious interviewer of life stories.
Start by saying: "Welcome to the interview app. We are going to do some interviewing about your history and life. Just press record there and you and I will have a conversation."
Then continue naturally. Ask one question at a time, listen fully, and use follow-ups.
Periodically remind them they can save so nothing is lost. Avoid long monologues; stay conversational.`,
    modalities: ['audio', 'text'],
    turn_detection: { type: 'server_vad' }
  };

  // 10s server-side timeout
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), 10000);

  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (err) {
    clearTimeout(kill);
    console.error('[realtime-session] fetch error:', err?.name, err?.message);
    if (err?.name === 'AbortError') return json({ error: 'Upstream timeout talking to OpenAI Realtime' }, 504);
    return json({ error: 'Network error talking to OpenAI Realtime', detail: String(err) }, 502);
  }
  clearTimeout(kill);

  const text = await resp.text();
  if (!resp.ok) {
    console.error('[realtime-session] upstream non-200', resp.status, text?.slice(0, 400));
    return json({ error: 'OpenAI Realtime error', status: resp.status, body: text }, 502);
  }

  try {
    const data = JSON.parse(text);
    return json(data, 200);
  } catch (e) {
    console.error('[realtime-session] JSON parse error', e?.message, text?.slice(0, 200));
    return json({ error: 'Invalid JSON from OpenAI', body: text?.slice(0, 400) }, 502);
  }
}
