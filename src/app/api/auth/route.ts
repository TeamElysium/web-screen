import { NextResponse } from 'next/server'
import { verifyPassword, createSessionToken } from '@/lib/auth'

export async function POST(request: Request) {
  const { password } = await request.json()

  if (!verifyPassword(password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const token = createSessionToken()
  const response = NextResponse.json({ ok: true })
  response.headers.set(
    'Set-Cookie',
    `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
  )
  return response
}
