import { exec, execFile } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

const SAFE_SESSION_NAME = /^[a-zA-Z0-9_-]+$/

export function validateSessionName(name: string): void {
  if (!name || !SAFE_SESSION_NAME.test(name)) {
    throw new Error(`Invalid session name: only alphanumeric, hyphen, underscore allowed`)
  }
  if (name.length > 100) {
    throw new Error('Session name too long')
  }
}

export interface ScreenSession {
  id: string
  name: string
  status: 'attached' | 'detached'
}

export function parseScreenList(output: string): ScreenSession[] {
  const sessions: ScreenSession[] = []
  const lines = output.split('\n')

  for (const line of lines) {
    const match = line.match(/^\t(\d+)\.(.+?)\t\((\w+)\)/)
    if (match) {
      sessions.push({
        id: match[1],
        name: match[2],
        status: match[3].toLowerCase() as ScreenSession['status'],
      })
    }
  }

  return sessions
}

export async function listSessions(): Promise<ScreenSession[]> {
  try {
    const { stdout } = await execAsync('screen -ls 2>&1')
    return parseScreenList(stdout)
  } catch (err: unknown) {
    // screen -ls exits with code 1 even when sessions exist
    if (err && typeof err === 'object' && 'stdout' in err) {
      return parseScreenList((err as { stdout: string }).stdout)
    }
    return []
  }
}

export async function createSession(name: string): Promise<void> {
  validateSessionName(name)
  if (await sessionExists(name)) {
    throw new Error(`Session "${name}" already exists`)
  }
  await execFileAsync('screen', ['-dmUS', name])
}

export async function sessionExists(name: string): Promise<boolean> {
  const sessions = await listSessions()
  return sessions.some(s => s.name === name)
}

export async function killSession(name: string): Promise<void> {
  validateSessionName(name)
  const sessions = await listSessions()
  const session = sessions.find(s => s.name === name)
  if (!session) {
    throw new Error(`Session "${name}" not found`)
  }
  await execFileAsync('screen', ['-S', `${session.id}.${session.name}`, '-X', 'quit'])
}
