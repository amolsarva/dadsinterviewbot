import './globals.css'
import React from 'react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const commitSha =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  const commitMessage =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE ?? process.env.VERCEL_GIT_COMMIT_MESSAGE ?? 'local changes'
  const commitTimestamp =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_TIMESTAMP ?? process.env.VERCEL_GIT_COMMIT_TIMESTAMP ?? null
  const repoOwner =
    process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_OWNER ?? process.env.VERCEL_GIT_REPO_OWNER ?? ''
  const repoSlug =
    process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG ?? process.env.VERCEL_GIT_REPO_SLUG ?? ''

  const shortSha = commitSha ? commitSha.slice(0, 7) : 'local'
  const commitUrl = commitSha && repoOwner && repoSlug ? `https://github.com/${repoOwner}/${repoSlug}/commit/${commitSha}` : null

  let formattedTime = 'just now (Eastern Time)'
  if (commitTimestamp) {
    const parsed = new Date(commitTimestamp)
    if (!Number.isNaN(parsed.valueOf())) {
      formattedTime = `${new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(parsed)} Eastern Time`
    }
  }

  return (
    <html lang="en">
      <body className="min-h-screen text-[var(--fg)] antialiased">
        <div className="pointer-events-none fixed inset-x-0 top-0 flex justify-center gap-10 px-8 pt-12 text-4xl text-amber-200/80 sm:text-5xl">
          <span className="drop-shadow-[0_0_18px_rgba(249,196,79,0.55)]" aria-hidden>
            🪔
          </span>
          <span className="drop-shadow-[0_0_18px_rgba(129,140,248,0.45)]" aria-hidden>
            🪷
          </span>
          <span className="drop-shadow-[0_0_20px_rgba(236,72,153,0.4)]" aria-hidden>
            🫖
          </span>
        </div>
        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-8">
          <header className="relative overflow-hidden rounded-[32px] border border-[rgba(255,244,214,0.14)] bg-[rgba(33,12,53,0.82)] px-6 py-6 shadow-[0_25px_80px_rgba(120,45,110,0.35)] backdrop-blur-xl sm:px-10">
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-[rgba(249,196,79,0.1)] to-[rgba(91,33,182,0.25)]"
              aria-hidden
            />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <p className="text-xs uppercase tracking-[0.5em] text-[rgba(255,247,237,0.6)]">Story Studio</p>
                <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Dad&apos;s Interview Bot</h1>
                <p className="mt-3 text-sm leading-relaxed text-[rgba(255,247,237,0.72)]">
                  A warm, colourful space for capturing the stories that make your family shine. Settle in with a cup of chai and let the conversation flow.
                </p>
              </div>
              <nav className="flex flex-wrap items-center gap-2 text-sm">
                {[
                  { href: '/', label: 'Home' },
                  { href: '/history', label: 'History' },
                  { href: '/settings', label: 'Settings' },
                  { href: '/diagnostics', label: 'Diagnostics' },
                ].map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="group relative overflow-hidden rounded-full border border-[rgba(255,214,150,0.35)] bg-[rgba(251,191,36,0.08)] px-4 py-2 font-medium text-[rgba(255,247,237,0.85)] transition hover:border-[rgba(249,115,22,0.5)] hover:bg-[rgba(249,115,22,0.16)] hover:text-white"
                  >
                    <span className="absolute inset-0 translate-y-full bg-gradient-to-r from-[rgba(249,115,22,0.35)] via-[rgba(217,70,239,0.2)] to-[rgba(129,140,248,0.35)] transition-transform duration-300 ease-out group-hover:translate-y-0" aria-hidden />
                    <span className="relative">{item.label}</span>
                  </a>
                ))}
              </nav>
            </div>
          </header>

          <div className="relative flex-1">
            <div className="relative overflow-hidden rounded-[36px] border border-[rgba(255,244,214,0.14)] bg-[rgba(33,12,53,0.86)] px-5 py-8 shadow-[0_30px_90px_rgba(120,45,110,0.35)] backdrop-blur-xl sm:px-12 sm:py-12">
              <div
                className="pointer-events-none absolute inset-0 opacity-80"
                style={{
                  background:
                    'radial-gradient(circle at 12% 20%, rgba(249, 196, 79, 0.18), transparent 60%), radial-gradient(circle at 88% 14%, rgba(217, 70, 239, 0.16), transparent 55%), radial-gradient(circle at 35% 80%, rgba(56, 189, 248, 0.12), transparent 60%)',
                }}
                aria-hidden
              />
              <div className="relative">{children}</div>
            </div>
          </div>

          <footer className="relative overflow-hidden rounded-[28px] border border-[rgba(255,244,214,0.14)] bg-[rgba(33,12,53,0.78)] px-6 py-4 text-xs text-[rgba(255,247,237,0.7)] shadow-[0_18px_60px_rgba(120,45,110,0.3)] backdrop-blur-xl sm:px-10">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-[rgba(249,196,79,0.08)] to-[rgba(91,33,182,0.18)]" aria-hidden />
            <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {commitUrl ? (
                  <a href={commitUrl} className="underline">
                    {shortSha} — {commitMessage}
                  </a>
                ) : (
                  <span>
                    {shortSha} — {commitMessage}
                  </span>
                )}{' '}
                · {formattedTime}
              </div>
              <div className="flex items-center gap-2 text-[rgba(255,247,237,0.7)]">
                <span aria-hidden>🪔</span>
                <span>Crafted with warmth for every family gathering.</span>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
