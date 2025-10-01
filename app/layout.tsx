import './globals.css'
import React from 'react'
import { SiteNav } from './site-nav'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const commitSha =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    process.env.COMMIT_REF ??
    process.env.RENDER_GIT_COMMIT ??
    ''
  const commitMessage =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE ??
    process.env.VERCEL_GIT_COMMIT_MESSAGE ??
    process.env.NEXT_PUBLIC_GIT_COMMIT_MESSAGE ??
    process.env.GIT_COMMIT_MESSAGE ??
    process.env.COMMIT_MESSAGE ??
    process.env.RENDER_GIT_COMMIT_MESSAGE ??
    'local changes'
  const commitTimestamp =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_TIMESTAMP ??
    process.env.VERCEL_GIT_COMMIT_TIMESTAMP ??
    process.env.NEXT_PUBLIC_GIT_COMMIT_TIMESTAMP ??
    process.env.GIT_COMMIT_TIMESTAMP ??
    process.env.DEPLOY_CREATED_AT ??
    null
  const repoOwner =
    process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_OWNER ??
    process.env.VERCEL_GIT_REPO_OWNER ??
    process.env.NEXT_PUBLIC_GIT_REPO_OWNER ??
    process.env.GIT_REPO_OWNER ??
    ''
  const repoSlug =
    process.env.NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG ??
    process.env.VERCEL_GIT_REPO_SLUG ??
    process.env.NEXT_PUBLIC_GIT_REPO_SLUG ??
    process.env.GIT_REPO_SLUG ??
    ''

  const githubRepo = process.env.GITHUB_REPOSITORY ?? process.env.NEXT_PUBLIC_GITHUB_REPOSITORY ?? ''
  const [githubOwner, githubSlug] = githubRepo.includes('/') ? githubRepo.split('/', 2) : ['', '']

  const shortSha = commitSha ? commitSha.slice(0, 7) : 'local'
  const finalRepoOwner = repoOwner || githubOwner
  const finalRepoSlug = repoSlug || githubSlug

  const commitUrl =
    commitSha && finalRepoOwner && finalRepoSlug
      ? `https://github.com/${finalRepoOwner}/${finalRepoSlug}/commit/${commitSha}`
      : null

  const easternFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const fallbackEasternTime = `${easternFormatter.format(new Date())} Eastern Time`
  let formattedTime = fallbackEasternTime
  if (commitTimestamp) {
    const parsed = new Date(commitTimestamp)
    if (!Number.isNaN(parsed.valueOf())) {
      formattedTime = `${easternFormatter.format(parsed)} Eastern Time`
    }
  }

  return (
    <html lang="en">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <h1 className="site-title">Dad&apos;s Interview Bot</h1>
            <SiteNav />
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
