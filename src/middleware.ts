import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip auth check for login page and auth API
  if (pathname === '/login' || pathname.startsWith('/api/auth') || pathname.startsWith('/_next')) {
    return NextResponse.next()
  }

  const session = request.cookies.get('session')?.value
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Token validation happens server-side; cookie presence is enough for middleware
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
