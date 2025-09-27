"use client"

import Link from 'next/link'
import { useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { normalizeHandle } from '@/lib/user-scope'

function deriveHandleFromPath(pathname: string | null): string | undefined {
  if (!pathname) return undefined
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && segments[0] === 'u') {
    return normalizeHandle(segments[1] ?? undefined)
  }
  return undefined
}

function buildScopedPath(target: string, handle?: string): string {
  if (!handle) return target
  const normalizedTarget = target.startsWith('/') ? target : `/${target}`
  if (normalizedTarget === '/' || normalizedTarget === '') {
    return `/u/${handle}`
  }
  return `/u/${handle}${normalizedTarget}`
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

  return (
    <nav className="site-nav">
      {links.map((link) => (
        <Link key={link.label} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
