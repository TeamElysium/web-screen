import { describe, it, expect } from 'vitest'
import { validateSessionName } from '@/lib/screen-manager'

describe('validateSessionName', () => {
  it('accepts valid names', () => {
    expect(() => validateSessionName('my-session')).not.toThrow()
    expect(() => validateSessionName('test_123')).not.toThrow()
    expect(() => validateSessionName('A')).not.toThrow()
  })

  // Mutation: removing the regex check would let these pass
  it('rejects shell injection via semicolon', () => {
    expect(() => validateSessionName('test; rm -rf /')).toThrow()
  })

  it('rejects shell injection via $(...)', () => {
    expect(() => validateSessionName('$(whoami)')).toThrow()
  })

  it('rejects shell injection via backticks', () => {
    expect(() => validateSessionName('`id`')).toThrow()
  })

  it('rejects shell injection via pipe', () => {
    expect(() => validateSessionName('test | cat /etc/passwd')).toThrow()
  })

  it('rejects shell injection via &&', () => {
    expect(() => validateSessionName('ok && evil')).toThrow()
  })

  it('rejects shell injection via newline', () => {
    expect(() => validateSessionName('test\nevil')).toThrow()
  })

  // Mutation: removing empty-string check would let this pass
  it('rejects empty string', () => {
    expect(() => validateSessionName('')).toThrow()
  })

  // Mutation: removing length check would let this pass
  it('rejects names over 100 chars', () => {
    expect(() => validateSessionName('a'.repeat(101))).toThrow()
  })

  it('accepts names at exactly 100 chars', () => {
    expect(() => validateSessionName('a'.repeat(100))).not.toThrow()
  })
})
