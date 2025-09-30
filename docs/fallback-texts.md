# Fallback Text Inventory

This catalog lists the hard-coded fallback copy currently used across the app so it can be reviewed and revised in one place. Each item links back to the source module for context.

## Session Title Defaults
- `Session on {DATE}` — used when no session title can be generated from transcript content.

  Sources: `lib/data.ts`, `app/api/history/route.ts`, and `app/page.tsx` when generating client-side history rows.

## Intro Flow Fallbacks
- `Hello. I'm having trouble loading up my memory. So let me welcome you for now and say that it probably makes sense for you to check if the app is in good working order. It might be an API or session management problem.'

  Sources: `app/api/session/[id]/intro/route.ts` and `app/page.tsx`.

## Question Fallbacks
- `I'm going to just ask another question now because I don't think I caught the previous comment well. Why don't you take me in a new direction for a topic you would like to discuss?'

  Source: `lib/question-memory.ts`.

## Ask Turn Fallback Replies
- When the model response omits a question, the fallback suggestion sentence from the question pool (see above) is appended automatically.

  Source: `app/api/ask-audio/route.ts`.
