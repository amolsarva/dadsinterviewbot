import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFoxes, listFoxes } from '../lib/foxes'

const putBlobMock = vi.fn(async (path: string, _buf: Buffer, _type: string, _options?: unknown) => ({
  url: `https://blob.test/${path}`,
}))
vi.mock('../lib/blob', () => ({
  putBlobFromBuffer: putBlobMock,
}))

const sendEmailMock = vi.fn()
vi.mock('../lib/email', () => ({
  sendSummaryEmail: sendEmailMock,
}))

describe('finalizeSession', () => {
  beforeEach(() => {
    vi.resetModules()
    putBlobMock.mockClear()
    sendEmailMock.mockReset()
    clearFoxes()
  })

  it('reports success when email provider succeeds', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ ok: true, provider: 'resend' })
    const session = await data.createSession({ email_to: 'user@example.com' })
    await data.appendTurn(session.id, { role: 'user', text: 'hello' })

    const result = await data.finalizeSession(session.id, { clientDurationMs: 1000 })
    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    expect(result.emailed).toBe(true)
    expect(result.emailStatus).toEqual({ ok: true, provider: 'resend' })
    expect(result.session.title && result.session.title.length).toBeTruthy()
    expect(result.session.title?.toLowerCase()).not.toContain('untitled')
    const stored = await data.getSession(session.id)
    expect(stored?.status).toBe('emailed')
    expect(stored?.title && stored.title.length).toBeTruthy()
  })

  it('handles skipped email when no provider configured', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ skipped: true })
    const session = await data.createSession({ email_to: 'user@example.com' })
    await data.appendTurn(session.id, { role: 'assistant', text: 'hi again' })

    const result = await data.finalizeSession(session.id, { clientDurationMs: 200 })
    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    expect(result.emailed).toBe(false)
    expect(result.emailStatus).toEqual({ skipped: true })
    const stored = await data.getSession(session.id)
    expect(stored?.status).toBe('completed')
    expect(stored?.title && stored.title.length).toBeTruthy()
  })

  it('flags failures from the email provider', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ ok: false, provider: 'resend', error: 'bad' })
    const session = await data.createSession({ email_to: 'user@example.com' })
    await data.appendTurn(session.id, { role: 'user', text: 'hi there' })

    const result = await data.finalizeSession(session.id, { clientDurationMs: 0 })
    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    expect(result.emailed).toBe(false)
    expect(result.emailStatus).toEqual({ ok: false, provider: 'resend', error: 'bad' })
    const stored = await data.getSession(session.id)
    expect(stored?.status).toBe('error')
    expect(stored?.title && stored.title.length).toBeTruthy()
    const foxes = listFoxes()
    expect(foxes.some((fox) => fox.id === 'theory-4-email-status-error')).toBe(true)
  })

  it('skips summary email when the session has no recipient', async () => {
    const data = await import('../lib/data')
    const session = await data.createSession({ email_to: '' })
    await data.appendTurn(session.id, { role: 'assistant', text: 'hello there' })

    const result = await data.finalizeSession(session.id, { clientDurationMs: 10 })
    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result.emailed).toBe(false)
    expect(result.emailStatus).toEqual({ skipped: true })
    expect(result.session.status).toBe('completed')
  })

  it('persists session audio artifacts when provided', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ skipped: true })
    const session = await data.createSession({ email_to: 'user@example.com' })

    await data.appendTurn(session.id, { role: 'assistant', text: 'hello again' })

    const result = await data.finalizeSession(session.id, {
      clientDurationMs: 1234,
      sessionAudioUrl: 'https://blob.test/sessions/123/session-audio.webm',
    })

    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    const stored = await data.getSession(session.id)
    expect(stored?.artifacts?.session_audio).toBe('https://blob.test/sessions/123/session-audio.webm')
  })
})
