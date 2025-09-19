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
      <body className="min-h-screen">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <header className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-semibold">Dad&apos;s Interview Bot</h1>
            <nav className="space-x-4 text-sm opacity-90">
              <a href="/" className="underline">Home</a>
              <a href="/history" className="underline">History</a>
              <a href="/settings" className="underline">Settings</a>
              <a href="/diagnostics" className="underline">Diagnostics</a>
            </nav>
          </header>
          {children}
          <footer className="mt-10 text-xs opacity-70">
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
          </footer>
        </div>
      </body>
    </html>
  )
}
