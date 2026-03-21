import { NextResponse } from 'next/server'
import { listSessions, createSession, sessionExists } from '@/lib/screen-manager'

export async function GET() {
  const sessions = await listSessions()
  return NextResponse.json(sessions)
}

export async function POST(request: Request) {
  const { name } = await request.json()

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  if (await sessionExists(name.trim())) {
    return NextResponse.json({ error: 'Session already exists' }, { status: 409 })
  }

  await createSession(name.trim())
  return NextResponse.json({ name: name.trim() }, { status: 201 })
}
