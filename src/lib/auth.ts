import { createHmac } from 'crypto'

const LOCALHOST_ALIASES = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

export function checkIP(ip: string): boolean {
  const allowed = process.env.ALLOWED_IPS
  if (!allowed || allowed.trim() === '') return true

  const allowedList = allowed.split(',').map(s => s.trim())

  // If client is any localhost variant and 127.0.0.1 is allowed, pass
  if (LOCALHOST_ALIASES.includes(ip) && allowedList.some(a => LOCALHOST_ALIASES.includes(a))) {
    return true
  }

  return allowedList.includes(ip)
}

export function verifyPassword(input: string): boolean {
  if (!input) return false
  return input === process.env.PASSWORD
}

export function createSessionToken(): string {
  const secret = process.env.PASSWORD || ''
  return createHmac('sha256', secret).update('web-screen-session').digest('hex')
}

export function validateSessionToken(token: string): boolean {
  if (!token) return false
  const expected = createSessionToken()
  return token === expected
}
