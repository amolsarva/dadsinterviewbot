import OpenAI from 'openai'

export async function synthesizeFollowup(userText: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return 'Tell me more about that moment. What happened next?' // mock
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `You are a patient, topic-aware interviewer. Wait for pauses, ask one thoughtful follow-up at a time. `},
      { role: 'user', content: userText }
    ],
  })
  return resp.choices[0]?.message?.content || 'Can you elaborate?'
}
