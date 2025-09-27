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
      <body>
        <div className="site-shell">
          <header className="site-header">
            <h1 className="site-title">Dad&apos;s Interview Bot</h1>
            <nav className="site-nav">
              <a href="/">Home</a>
              <a href="/history">History</a>
              <a href="/settings">Settings</a>
              <a href="/diagnostics">Diagnostics</a>
            </nav>
          </header>
          <div className="panel-section">{children}</div>
          <footer className="site-footer">
            {commitUrl ? (
              <a href={commitUrl}>
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
