import { NextResponse } from 'next/server'
import { verifyPassword, createSessionToken } from '@/lib/auth'
import { getWaitTime, recordFailure, recordSuccess } from '@/lib/rate-limit'

function cookieFlags(): string {
  const secure = process.env.SECURE_COOKIE === 'true' ? ' Secure;' : ''
  return `Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=86400`
}

function getBaseUrl(request: Request): string {
  const host = request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  if (host) {
    return `${proto}://${host}`
  }
  return new URL(request.url).origin
}

export async function POST(request: Request) {
  const waitMs = getWaitTime()
  if (waitMs > 0) {
    return NextResponse.json(
      { error: 'Too many attempts', retryAfterMs: waitMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(waitMs / 1000)) } }
    )
  }

  let password = ''
  const baseUrl = getBaseUrl(request)

  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await request.json()
    password = body.password || ''
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData()
    password = (formData.get('password') as string) || ''
  }

  if (!verifyPassword(password)) {
    recordFailure()
    if (contentType.includes('application/x-www-form-urlencoded')) {
      return NextResponse.redirect(`${baseUrl}/login?error=1`, 303)
    }
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  recordSuccess()
  const token = createSessionToken()

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const response = NextResponse.redirect(`${baseUrl}/`, 303)
    response.headers.set(
      'Set-Cookie',
      `session=${token}; ${cookieFlags()}`
    )
    return response
  }

  const response = NextResponse.json({ ok: true })
  response.headers.set(
    'Set-Cookie',
    `session=${token}; ${cookieFlags()}`
  )
  return response
}
