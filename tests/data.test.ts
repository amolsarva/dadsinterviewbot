import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFoxes, listFoxes } from '../lib/foxes'

const TEST_USER_ID = 'test-user'

const putBlobMock = vi.fn(async (path: string, _buf: Buffer, _type: string, _options?: unknown) => ({
  url: `https://blob.test/${path}`,
}))
const listBlobsMock = vi.fn(async () => ({ blobs: [] }))
const deleteByPrefixMock = vi.fn(async () => 0)
const deleteBlobMock = vi.fn(async () => false)
vi.mock('../lib/blob', () => ({
  putBlobFromBuffer: putBlobMock,
  listBlobs: listBlobsMock,
  deleteBlobsByPrefix: deleteByPrefixMock,
  deleteBlob: deleteBlobMock,
}))

const sendEmailMock = vi.fn()
vi.mock('../lib/email', () => ({
  sendSummaryEmail: sendEmailMock,
}))

describe('finalizeSession', () => {
  beforeEach(async () => {
    vi.resetModules()
    putBlobMock.mockClear()
    listBlobsMock.mockClear()
    deleteByPrefixMock.mockClear()
    deleteBlobMock.mockClear()
    sendEmailMock.mockReset()
    clearFoxes()
    const data = await import('../lib/data')
    data.__dangerousResetMemoryState()
  })

  it('reports success when email provider succeeds', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ ok: true, provider: 'resend' })
    const session = await data.createSession(TEST_USER_ID, { email_to: 'user@example.com' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'user', text: 'hello' })

    const result = await data.finalizeSession(TEST_USER_ID, session.id, { clientDurationMs: 1000 })
    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    expect(result.emailed).toBe(true)
    expect(result.emailStatus).toEqual({ ok: true, provider: 'resend' })
    expect(result.session.title && result.session.title.length).toBeTruthy()
    expect(result.session.title?.toLowerCase()).not.toContain('untitled')
    const stored = await data.getSession(TEST_USER_ID, session.id)
    expect(stored?.status).toBe('emailed')
    expect(stored?.title && stored.title.length).toBeTruthy()
  })

  it('handles skipped email when no provider configured', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ skipped: true })
    const session = await data.createSession(TEST_USER_ID, { email_to: 'user@example.com' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'assistant', text: 'hi again' })

    const result = await data.finalizeSession(TEST_USER_ID, session.id, { clientDurationMs: 200 })
    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    expect(result.emailed).toBe(false)
    expect(result.emailStatus).toEqual({ skipped: true })
    const stored = await data.getSession(TEST_USER_ID, session.id)
    expect(stored?.status).toBe('completed')
    expect(stored?.title && stored.title.length).toBeTruthy()
  })

  it('flags failures from the email provider', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ ok: false, provider: 'resend', error: 'bad' })
    const session = await data.createSession(TEST_USER_ID, { email_to: 'user@example.com' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'user', text: 'hi there' })

    const result = await data.finalizeSession(TEST_USER_ID, session.id, { clientDurationMs: 0 })
    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    expect(result.emailed).toBe(false)
    expect(result.emailStatus).toEqual({ ok: false, provider: 'resend', error: 'bad' })
    const stored = await data.getSession(TEST_USER_ID, session.id)
    expect(stored?.status).toBe('error')
    expect(stored?.title && stored.title.length).toBeTruthy()
    const foxes = listFoxes()
    expect(foxes.some((fox) => fox.id === 'theory-4-email-status-error')).toBe(true)
  })

  it('skips summary email when the session has no recipient', async () => {
    const data = await import('../lib/data')
    const session = await data.createSession(TEST_USER_ID, { email_to: '' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'assistant', text: 'hello there' })

    const result = await data.finalizeSession(TEST_USER_ID, session.id, { clientDurationMs: 10 })
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
    const session = await data.createSession(TEST_USER_ID, { email_to: 'user@example.com' })

    await data.appendTurn(TEST_USER_ID, session.id, { role: 'assistant', text: 'hello again' })

    const result = await data.finalizeSession(TEST_USER_ID, session.id, {
      clientDurationMs: 1234,
      sessionAudioUrl: 'https://blob.test/sessions/123/session-audio.webm',
    })

    if (!('session' in result)) {
      throw new Error('Expected session result')
    }

    const stored = await data.getSession(TEST_USER_ID, session.id)
    expect(stored?.artifacts?.session_audio).toBe('https://blob.test/sessions/123/session-audio.webm')
  })

  it('updates the memory primer with highlights from the session', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ skipped: true })
    const session = await data.createSession(TEST_USER_ID, { email_to: '' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'user', text: 'hello there from the porch' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'assistant', text: 'thanks for sharing that scene' })

    await data.finalizeSession(TEST_USER_ID, session.id, { clientDurationMs: 500 })

    const primer = await data.getMemoryPrimer(TEST_USER_ID)
    expect(primer.text).toContain('User opened with: hello there from the porch')
    expect(
      putBlobMock.mock.calls.some(([path]) => path === `users/${TEST_USER_ID}/memory/MemoryPrimer.txt`),
    ).toBe(true)
  })
})

describe('session deletion helpers', () => {
  beforeEach(async () => {
    vi.resetModules()
    putBlobMock.mockClear()
    listBlobsMock.mockClear()
    deleteByPrefixMock.mockClear()
    deleteBlobMock.mockClear()
    sendEmailMock.mockReset()
    clearFoxes()
    const data = await import('../lib/data')
    data.__dangerousResetMemoryState()
    deleteByPrefixMock.mockImplementation(async () => 0)
    deleteBlobMock.mockImplementation(async () => true)
  })

  it('deletes a specific session and updates the primer state', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ skipped: true })
    const session = await data.createSession(TEST_USER_ID, { email_to: '' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'user', text: 'memory highlight to remove' })
    await data.finalizeSession(TEST_USER_ID, session.id, { clientDurationMs: 100 })

    deleteByPrefixMock.mockImplementation(async (prefix: string) => {
      if (prefix.includes('/sessions/')) return 1
      if (prefix.includes('/transcripts/')) return 1
      return 0
    })

    const result = await data.deleteSession(TEST_USER_ID, session.id)

    expect(result).toEqual({ ok: true, deleted: true })
    expect(deleteByPrefixMock).toHaveBeenCalledWith(`users/${TEST_USER_ID}/sessions/${session.id}/`)
    expect(deleteByPrefixMock).toHaveBeenCalledWith(`users/${TEST_USER_ID}/transcripts/${session.id}`)
    expect(deleteBlobMock).toHaveBeenCalledWith(`users/${TEST_USER_ID}/memory/MemoryPrimer.txt`)

    const primer = await data.getMemoryPrimer(TEST_USER_ID)
    expect(primer.text).not.toContain('memory highlight to remove')
  })

  it('clears all sessions and blob records', async () => {
    const data = await import('../lib/data')
    sendEmailMock.mockResolvedValue({ skipped: true })
    const session = await data.createSession(TEST_USER_ID, { email_to: '' })
    await data.appendTurn(TEST_USER_ID, session.id, { role: 'assistant', text: 'hello' })
    await data.finalizeSession(TEST_USER_ID, session.id, { clientDurationMs: 200 })

    deleteByPrefixMock.mockImplementation(async () => 1)

    await data.clearAllSessions(TEST_USER_ID)

    expect(deleteByPrefixMock).toHaveBeenCalledWith(`users/${TEST_USER_ID}/sessions/`)
    expect(deleteByPrefixMock).toHaveBeenCalledWith(`users/${TEST_USER_ID}/transcripts/`)
    expect(deleteByPrefixMock).toHaveBeenCalledWith(`users/${TEST_USER_ID}/memory/`)
    expect(deleteBlobMock).toHaveBeenCalledWith(`users/${TEST_USER_ID}/memory/MemoryPrimer.txt`)

    const sessions = await data.listSessions(TEST_USER_ID)
    expect(sessions).toEqual([])
  })
})
