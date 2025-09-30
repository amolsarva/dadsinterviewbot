# Fallback Text Inventory

This catalog lists the hard-coded fallback copy currently used across the app so it can be reviewed and revised in one place. Each item links back to the source module for context.

## Session Title Defaults
- `Session on {DATE}` — used when no session title can be generated from transcript content.

  Sources: `lib/data.ts`, `app/api/history/route.ts`, and `app/page.tsx` when generating client-side history rows.

## Intro Flow Fallbacks
- `Welcome back—I'm keeping your stories about {title list} safe for you.` (returning storyteller with remembered titles)
- `Welcome back—your archive is open and I'm ready whenever you are.` (returning storyteller without specific titles)
- `Hi, I'm Dad's Interview Bot. I'm here to help you capture the memories you want to keep.` (first-time storyteller)
- `The last thing you shared was about {latest detail}.`
- `I'll remember every detail you share from this moment on.`
- `When you are ready, …` (returning session invitation)
- `When you feel ready, …` (first session invitation)
- `Where would you like to pick up the story?` (default continuation question)
- `Would you start by telling me the first memory you'd like to save together?` (first session default question)
- `Welcome back. I remember everything you have trusted me with. Tell me one new detail you would like to explore now.` (client-side intro fallback when the API cannot provide an opening line)

  Sources: `app/api/session/[id]/intro/route.ts` and `app/page.tsx`.

## Question Fallbacks
- `When you think about {latest detail}, what else stands out now?` (detail-sensitive guard question)
- Pool of backup prompts:
  - `Could you set the scene for me—where were you when this memory took place?`
  - `Who else shared that moment with you, and what were they doing?`
  - `What was the very first thing you noticed as it unfolded?`
  - `What feeling rushed in right away?`
  - `Is there a small sound or scent that still brings it back to you?`
  - `Was there an object in the room that now holds extra meaning for you?`
  - `What was happening just a few moments before everything began?`
  - `How did the light or weather color that scene for you?`
  - `What voices or music drifted through the background?`
  - `Was there a taste or texture that anchors the memory for you?`
- Final guard question: `Tell me one detail you have not shared with me yet.`

  Source: `lib/question-memory.ts`.

## Ask Turn Fallback Replies
- `Hi, I'm Dad's Interview Bot. I'm here to help you save the stories and small details your family will want to revisit. When it feels right, would you start with a memory you'd like me to remember?`
- `Welcome back. I'm still holding onto what you told me about {highlight detail}. Let's add another chapter to your archive.`
- `Welcome back—your story archive is open and I'm keeping track of everything you've trusted me with.`
- `Who else was there? Share a first name and one detail about them.` (used when the provider call throws)
- When the model response omits a question, the fallback suggestion sentence from the question pool (see above) is appended automatically.

  Source: `app/api/ask-audio/route.ts`.
