export const runtime = 'edge';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return new Response('Missing OPENAI_API_KEY', { status: 500 });

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

  const resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.text();
    return new Response(`Session error: ${err}`, { status: 500 });
  }

  const json = await resp.json();
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
