import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkIP, getClientIPFromHeaders } from './lib/auth'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/_next')) {
    return NextResponse.next()
  }

  const clientIP = getClientIPFromHeaders(request.headers)
  if (!checkIP(clientIP)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
