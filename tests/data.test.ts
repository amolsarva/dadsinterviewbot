import { beforeEach, describe, expect, it, vi } from 'vitest'

const putBlobMock = vi.fn(async (path: string, _buf: Buffer, _type: string, _options?: unknown) => ({
  url: `https://blob.test/${path}`,
}))
vi.mock('../lib/blob', () => ({
  putBlobFromBuffer: putBlobMock,
  listBlobs: vi.fn(async () => ({ blobs: [], hasMore: false })),
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
  })

  it('reports success when email provider succeeds', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ ok: true, provider: 'resend' })
    const session = await data.createSession({ email_to: 'user@example.com' })
    await data.appendTurn(session.id, { role: 'user', text: 'hello' })

    const result = await data.finalizeSession(session.id, { clientDurationMs: 1000 })

    expect(result.emailed).toBe(true)
    expect(result.emailStatus).toEqual({ ok: true, provider: 'resend' })
    expect(result.session.artifacts?.session_manifest).toEqual(
      'https://blob.test/sessions/' + session.id + '/session-' + session.id + '.json'
    )
    const stored = await data.getSession(session.id)
    expect(stored?.status).toBe('emailed')
  })

  it('handles skipped email when no provider configured', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ skipped: true })
    const session = await data.createSession({ email_to: 'user@example.com' })
    await data.appendTurn(session.id, { role: 'assistant', text: 'hi again' })

    const result = await data.finalizeSession(session.id, { clientDurationMs: 200 })

    expect(result.emailed).toBe(false)
    expect(result.emailStatus).toEqual({ skipped: true })
    expect(result.session.artifacts?.session_manifest).toEqual(
      'https://blob.test/sessions/' + session.id + '/session-' + session.id + '.json'
    )
    const stored = await data.getSession(session.id)
    expect(stored?.status).toBe('completed')
  })

  it('flags failures from the email provider', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ ok: false, provider: 'resend', error: 'bad' })
    const session = await data.createSession({ email_to: 'user@example.com' })
    await data.appendTurn(session.id, { role: 'user', text: 'hi there' })

    const result = await data.finalizeSession(session.id, { clientDurationMs: 0 })

    expect(result.emailed).toBe(false)
    expect(result.emailStatus).toEqual({ ok: false, provider: 'resend', error: 'bad' })
    expect(result.session.artifacts?.session_manifest).toEqual(
      'https://blob.test/sessions/' + session.id + '/session-' + session.id + '.json'
    )
    const stored = await data.getSession(session.id)
    expect(stored?.status).toBe('error')
  })
})
