import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the auth module before importing the route
vi.mock('@/lib/auth', () => ({
  verifyPassword: (input: string) => input === 'correct-password',
  createSessionToken: () => 'mock-token',
}))

describe('POST /api/auth', () => {
  beforeEach(() => {
    vi.stubEnv('PASSWORD', 'correct-password')
  })

  async function callRoute(body: Record<string, string>) {
    const { POST } = await import('@/app/api/auth/route')
    const request = new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return POST(request)
  }

  it('returns 200 and sets cookie for correct password', async () => {
    const res = await callRoute({ password: 'correct-password' })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('HttpOnly')
  })

  it('returns 401 for wrong password', async () => {
    const res = await callRoute({ password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('returns 401 for empty password', async () => {
    const res = await callRoute({ password: '' })
    expect(res.status).toBe(401)
  })
})
