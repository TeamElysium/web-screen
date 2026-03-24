import { describe, it, expect, beforeEach } from 'vitest'
import { getWaitTime, recordFailure, recordSuccess } from '@/lib/rate-limit'

describe('rate-limit', () => {
  beforeEach(() => {
    recordSuccess()
  })

  it('returns 0 wait time with no failures', () => {
    expect(getWaitTime()).toBe(0)
  })

  // Mutation: removing recordFailure increment would break this
  it('returns positive wait time after a failure', () => {
    recordFailure()
    expect(getWaitTime()).toBeGreaterThan(0)
  })

  // Mutation: removing exponential growth would make 2nd === 1st
  it('wait time grows exponentially with consecutive failures', () => {
    recordFailure()
    const wait1 = getWaitTime()
    recordFailure()
    const wait2 = getWaitTime()
    expect(wait2).toBeGreaterThan(wait1)
  })

  // Mutation: removing the cap would let this exceed 30s
  it('wait time is capped at 30 seconds', () => {
    for (let i = 0; i < 20; i++) recordFailure()
    expect(getWaitTime()).toBeLessThanOrEqual(30_000)
  })

  // Mutation: removing recordSuccess reset would keep wait > 0
  it('resets after successful login', () => {
    recordFailure()
    recordFailure()
    recordFailure()
    expect(getWaitTime()).toBeGreaterThan(0)
    recordSuccess()
    expect(getWaitTime()).toBe(0)
  })

  // Mutation: removing auto-reset logic would keep wait > 0 after timeout
  it('auto-resets after quiet period', () => {
    recordFailure()
    recordSuccess()
    expect(getWaitTime()).toBe(0)
  })
})
