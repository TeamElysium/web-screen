import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkIP, verifyPassword, createSessionToken, validateSessionToken } from '@/lib/auth'

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

  it('allows all when ALLOWED_IPS is empty', () => {
    vi.stubEnv('ALLOWED_IPS', '')
    expect(checkIP('1.2.3.4')).toBe(true)
  })

  it('allows all when ALLOWED_IPS is not set', () => {
    delete process.env.ALLOWED_IPS
    expect(checkIP('1.2.3.4')).toBe(true)
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
})

describe('verifyPassword', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns true for correct password', () => {
    vi.stubEnv('PASSWORD', 'secret123')
    expect(verifyPassword('secret123')).toBe(true)
  })

  it('returns false for wrong password', () => {
    vi.stubEnv('PASSWORD', 'secret123')
    expect(verifyPassword('wrong')).toBe(false)
  })

  it('returns false for empty input', () => {
    vi.stubEnv('PASSWORD', 'secret123')
    expect(verifyPassword('')).toBe(false)
  })
})

describe('session token', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('PASSWORD', 'secret123')
  })

  it('createSessionToken returns a non-empty string', () => {
    const token = createSessionToken()
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  it('validateSessionToken returns true for valid token', () => {
    const token = createSessionToken()
    expect(validateSessionToken(token)).toBe(true)
  })

  it('validateSessionToken returns false for invalid token', () => {
    expect(validateSessionToken('bogus-token')).toBe(false)
  })

  it('validateSessionToken returns false for empty string', () => {
    expect(validateSessionToken('')).toBe(false)
  })

  it('token becomes invalid when PASSWORD changes', () => {
    const token = createSessionToken()
    vi.stubEnv('PASSWORD', 'newpassword')
    expect(validateSessionToken(token)).toBe(false)
  })
})
