/**
 * Global rate limiter with exponential backoff.
 * Single-user assumption: tracks one global failure counter, not per-IP.
 */

const MAX_DELAY_MS = 30_000   // 30s upper bound
const BASE_DELAY_MS = 1_000   // 1s after first failure
const RESET_AFTER_MS = 60_000 // reset counter after 1min of no failures

let failureCount = 0
let lastFailureAt = 0

export function recordFailure(): void {
  failureCount++
  lastFailureAt = Date.now()
}

export function recordSuccess(): void {
  failureCount = 0
  lastFailureAt = 0
}

/** Returns ms the caller must wait before proceeding, or 0 if OK. */
export function getWaitTime(): number {
  if (failureCount === 0) return 0

  // Auto-reset after quiet period
  if (Date.now() - lastFailureAt > RESET_AFTER_MS) {
    failureCount = 0
    lastFailureAt = 0
    return 0
  }

  // Exponential: 1s, 2s, 4s, 8s, … capped at 30s
  const delay = Math.min(BASE_DELAY_MS * 2 ** (failureCount - 1), MAX_DELAY_MS)
  const elapsed = Date.now() - lastFailureAt
  return Math.max(delay - elapsed, 0)
}
