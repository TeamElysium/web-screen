import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CLIENT_IP_HEADER,
  checkIP,
  getClientIPForServer,
  getClientIPFromHeaders,
  normalizeIP,
} from '@/lib/auth'

describe('checkIP', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows exact IP match', () => {
    vi.stubEnv('ALLOWED_IPS', '192.168.1.10')
    expect(checkIP('192.168.1.10')).toBe(true)
  })

  it('rejects non-matching IP', () => {
    vi.stubEnv('ALLOWED_IPS', '192.168.1.10')
    expect(checkIP('10.0.0.1')).toBe(false)
  })

  it('allows multiple IPs (comma separated)', () => {
    vi.stubEnv('ALLOWED_IPS', '192.168.1.10,10.0.0.1')
    expect(checkIP('10.0.0.1')).toBe(true)
  })

  it('rejects all when ALLOWED_IPS is empty', () => {
    vi.stubEnv('ALLOWED_IPS', '')
    expect(checkIP('1.2.3.4')).toBe(false)
  })

  it('rejects all when ALLOWED_IPS is not set', () => {
    delete process.env.ALLOWED_IPS
    expect(checkIP('1.2.3.4')).toBe(false)
  })

  it('allows localhost variants', () => {
    vi.stubEnv('ALLOWED_IPS', '127.0.0.1')
    expect(checkIP('127.0.0.1')).toBe(true)
    expect(checkIP('::1')).toBe(true)
    expect(checkIP('::ffff:127.0.0.1')).toBe(true)
  })

  it('trims whitespace in IP list', () => {
    vi.stubEnv('ALLOWED_IPS', ' 192.168.1.10 , 10.0.0.1 ')
    expect(checkIP('192.168.1.10')).toBe(true)
  })

  it('matches IPv4-mapped addresses against plain IPv4 allowlist entries', () => {
    vi.stubEnv('ALLOWED_IPS', '192.168.1.10')
    expect(checkIP('::ffff:192.168.1.10')).toBe(true)
  })

  it('rejects empty client IP', () => {
    vi.stubEnv('ALLOWED_IPS', '192.168.1.10')
    expect(checkIP('')).toBe(false)
  })
})

describe('normalizeIP', () => {
  it('strips IPv4 ports and IPv6 brackets', () => {
    expect(normalizeIP('192.168.1.10:3000')).toBe('192.168.1.10')
    expect(normalizeIP('[::1]:3000')).toBe('::1')
  })

  it('uses the first x-forwarded-for entry', () => {
    expect(normalizeIP('192.168.1.10, 10.0.0.1')).toBe('192.168.1.10')
  })

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIP('::ffff:192.168.1.10')).toBe('192.168.1.10')
  })
})

describe('getClientIPFromHeaders', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers the server-injected client IP header', () => {
    const headers = new Headers({
      [CLIENT_IP_HEADER]: '192.168.1.10',
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '10.0.0.2',
    })

    expect(getClientIPFromHeaders(headers)).toBe('192.168.1.10')
  })

  it('does not trust proxy headers by default', () => {
    const headers = new Headers({
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '10.0.0.2',
    })

    expect(getClientIPFromHeaders(headers)).toBe('')
  })

  it('uses x-real-ip when TRUST_PROXY is enabled', () => {
    vi.stubEnv('TRUST_PROXY', 'true')
    const headers = new Headers({
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '10.0.0.2',
    })

    expect(getClientIPFromHeaders(headers)).toBe('10.0.0.1')
  })

  it('uses x-forwarded-for when TRUST_PROXY is enabled', () => {
    vi.stubEnv('TRUST_PROXY', 'true')
    const headers = new Headers({
      'x-forwarded-for': '10.0.0.2, 10.0.0.3',
    })

    expect(getClientIPFromHeaders(headers)).toBe('10.0.0.2')
  })

  it('supports plain header maps', () => {
    expect(getClientIPFromHeaders({ [CLIENT_IP_HEADER]: '::ffff:127.0.0.1' })).toBe('127.0.0.1')
  })
})

describe('getClientIPForServer', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the TCP peer address by default', () => {
    expect(getClientIPForServer({ 'x-real-ip': '10.0.0.1' }, '192.168.1.10')).toBe('192.168.1.10')
  })

  it('does not trust a client-supplied internal header', () => {
    expect(getClientIPForServer({ [CLIENT_IP_HEADER]: '10.0.0.1' }, '192.168.1.10')).toBe('192.168.1.10')
  })

  it('uses proxy headers when TRUST_PROXY is enabled', () => {
    vi.stubEnv('TRUST_PROXY', 'true')
    expect(getClientIPForServer({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }, '192.168.1.10')).toBe('10.0.0.1')
  })

  it('falls back to TCP peer address when TRUST_PROXY is enabled without proxy headers', () => {
    vi.stubEnv('TRUST_PROXY', 'true')
    expect(getClientIPForServer({}, '192.168.1.10')).toBe('192.168.1.10')
  })
})
