import './globals.css'
import React from 'react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
          <footer className="mt-10 text-xs opacity-70">v1.3.1 — continuity-first build.</footer>
        </div>
      </body>
    </html>
  )
}
