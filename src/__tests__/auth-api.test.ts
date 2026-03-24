import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the auth module before importing the route
vi.mock('@/lib/auth', () => ({
  verifyPassword: (input: string) => input === 'correct-password',
  createSessionToken: () => 'mock-token',
}))

// Disable rate limiting in auth-api tests
vi.mock('@/lib/rate-limit', () => ({
  getWaitTime: () => 0,
  recordFailure: () => {},
  recordSuccess: () => {},
}))

describe('POST /api/auth (JSON)', () => {
  beforeEach(() => {
    vi.stubEnv('PASSWORD', 'correct-password')
  })

  async function callJSON(body: Record<string, string>) {
    const { POST } = await import('@/app/api/auth/route')
    const request = new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return POST(request)
  }

  it('returns 200 and sets cookie for correct password', async () => {
    const res = await callJSON({ password: 'correct-password' })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('HttpOnly')
  })

  it('returns 401 for wrong password', async () => {
    const res = await callJSON({ password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('returns 401 for empty password', async () => {
    const res = await callJSON({ password: '' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth (form-urlencoded, localhost)', () => {
  beforeEach(() => {
    vi.stubEnv('PASSWORD', 'correct-password')
  })

  async function callForm(password: string) {
    const { POST } = await import('@/app/api/auth/route')
    const body = new URLSearchParams({ password })
    const request = new Request('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': 'localhost:3000',
      },
      body: body.toString(),
    })
    return POST(request)
  }

  it('redirects to / with cookie on correct password', async () => {
    const res = await callForm('correct-password')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://localhost:3000/')
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('HttpOnly')
  })

  it('redirects to /login?error=1 on wrong password', async () => {
    const res = await callForm('wrong')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login?error=1')
  })
})

describe('POST /api/auth (form-urlencoded, external IP)', () => {
  beforeEach(() => {
    vi.stubEnv('PASSWORD', 'correct-password')
  })

  async function callFormExternal(password: string) {
    const { POST } = await import('@/app/api/auth/route')
    const body = new URLSearchParams({ password })
    const request = new Request('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': '100.77.70.42:3000',
      },
      body: body.toString(),
    })
    return POST(request)
  }

  it('redirects to external IP origin on correct password', async () => {
    const res = await callFormExternal('correct-password')
    expect(res.status).toBe(303)
    const location = res.headers.get('location')
    expect(location).toBe('http://100.77.70.42:3000/')
    expect(location).not.toContain('localhost')
  })

  it('redirects to external IP origin on wrong password', async () => {
    const res = await callFormExternal('wrong')
    expect(res.status).toBe(303)
    const location = res.headers.get('location')
    expect(location).toBe('http://100.77.70.42:3000/login?error=1')
    expect(location).not.toContain('localhost')
  })

  it('redirects preserve cookie on correct password from external', async () => {
    const res = await callFormExternal('correct-password')
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('session=')
    expect(setCookie).toContain('HttpOnly')
  })
})
