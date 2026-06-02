import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CLIENT_IP_HEADER } from '@/lib/auth'
import { middleware } from '@/middleware'

function request(path: string, ip: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      [CLIENT_IP_HEADER]: ip,
    },
  })
}

describe('middleware IP allowlist', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows requests from ALLOWED_IPS', () => {
    vi.stubEnv('ALLOWED_IPS', '192.168.1.10')

    const response = middleware(request('/', '192.168.1.10'))

    expect(response.status).toBe(200)
  })

  it('blocks requests outside ALLOWED_IPS', () => {
    vi.stubEnv('ALLOWED_IPS', '192.168.1.10')

    const response = middleware(request('/', '10.0.0.1'))

    expect(response.status).toBe(403)
  })

  it('blocks requests when ALLOWED_IPS is not configured', () => {
    const response = middleware(request('/', '192.168.1.10'))

    expect(response.status).toBe(403)
  })
})
