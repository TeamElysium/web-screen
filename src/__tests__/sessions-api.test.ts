import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSessions = [
  { id: '12345', name: 'session1', status: 'detached' as const },
  { id: '67890', name: 'session2', status: 'attached' as const },
]

vi.mock('@/lib/screen-manager', () => ({
  listSessions: vi.fn().mockResolvedValue(mockSessions),
  createSession: vi.fn().mockResolvedValue(undefined),
  sessionExists: vi.fn().mockResolvedValue(false),
  killSession: vi.fn().mockResolvedValue(undefined),
}))

describe('GET /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns session list as JSON', async () => {
    const { GET } = await import('@/app/api/sessions/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual(mockSessions)
  })
})

describe('POST /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new session and returns 201', async () => {
    const { createSession } = await import('@/lib/screen-manager')
    const { POST } = await import('@/app/api/sessions/route')
    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-session' }),
    })
    const res = await POST(request)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.name).toBe('new-session')
    expect(createSession).toHaveBeenCalledWith('new-session')
  })

  it('returns 400 for empty name', async () => {
    const { POST } = await import('@/app/api/sessions/route')
    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    const res = await POST(request)
    expect(res.status).toBe(400)
  })

  it('returns 409 for duplicate session', async () => {
    const { sessionExists } = await import('@/lib/screen-manager')
    vi.mocked(sessionExists).mockResolvedValueOnce(true)

    const { POST } = await import('@/app/api/sessions/route')
    const request = new Request('http://localhost/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'existing' }),
    })
    const res = await POST(request)
    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes an existing session and returns ok', async () => {
    const { sessionExists, killSession } = await import('@/lib/screen-manager')
    vi.mocked(sessionExists).mockResolvedValueOnce(true)

    const { DELETE } = await import('@/app/api/sessions/route')
    const request = new Request('http://localhost/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'session1' }),
    })
    const res = await DELETE(request)
    expect(res.status).toBe(200)
    expect(killSession).toHaveBeenCalledWith('session1')
  })

  it('returns 400 for empty name', async () => {
    const { DELETE } = await import('@/app/api/sessions/route')
    const request = new Request('http://localhost/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    const res = await DELETE(request)
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-existing session', async () => {
    const { sessionExists } = await import('@/lib/screen-manager')
    vi.mocked(sessionExists).mockResolvedValueOnce(false)

    const { DELETE } = await import('@/app/api/sessions/route')
    const request = new Request('http://localhost/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ghost' }),
    })
    const res = await DELETE(request)
    expect(res.status).toBe(404)
  })
})
