import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
  if (await sessionExists(name)) {
    throw new Error(`Session "${name}" already exists`)
  }
  await execAsync(`screen -dmS ${name}`)
}

export async function sessionExists(name: string): Promise<boolean> {
  const sessions = await listSessions()
  return sessions.some(s => s.name === name)
}
