"use client"

import Link from 'next/link'
import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { buildScopedPath, normalizeHandle } from '@/lib/user-scope'

function deriveHandleFromPath(pathname: string | null): string | undefined {
  if (!pathname) return undefined
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && segments[0] === 'u') {
    return normalizeHandle(segments[1] ?? undefined)
  }
  return undefined
}

function normalizePathForMatch(path: string | null): string {
  if (!path) return '/'
  const stripped = path.split('?')[0]?.split('#')[0] ?? ''
  if (stripped === '/' || stripped === '') return '/'
  const withoutTrailing = stripped.replace(/\/+$/g, '')
  return withoutTrailing.length ? withoutTrailing : '/'
}

function isPathMatch(path: string, target: string): boolean {
  if (target === '/') {
    return path === '/'
  }
  if (path === target) return true
  return path.startsWith(`${target}/`)
}

export function SiteNav() {
  const pathname = usePathname()
  const handle = useMemo(() => deriveHandleFromPath(pathname), [pathname])

  const links = useMemo(
    () => [
      { href: buildScopedPath('/', handle), label: 'Home' },
      { href: buildScopedPath('/history', handle), label: 'History' },
      { href: buildScopedPath('/settings', handle), label: 'Settings' },
      { href: buildScopedPath('/diagnostics', handle), label: 'Diagnostics' },
    ],
    [handle],
  )

  const normalizedPath = useMemo(() => normalizePathForMatch(pathname), [pathname])

  const activeHref = useMemo(() => {
    let match: string | null = null
    let matchLength = -1
    for (const link of links) {
      const normalizedTarget = normalizePathForMatch(link.href)
      if (!isPathMatch(normalizedPath, normalizedTarget)) continue
      if (normalizedTarget.length > matchLength) {
        match = link.href
        matchLength = normalizedTarget.length
      }
    }
    return match
  }, [links, normalizedPath])

  return (
    <nav className="site-nav">
      {links.map((link) => {
        const isActive = link.href === activeHref
        return (
          <Link
            key={link.label}
            href={link.href}
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? 'active' : undefined}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
