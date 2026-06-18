import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  backendArgs,
  backendCommand,
  cleanupSessionsArgs,
  createDetachedSessionArgs,
  killSessionArgs,
  listSessionsArgs,
  parseTmuxList,
  terminalBackendKind,
  type TerminalSession,
} from './terminal-backend'

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
    const match = line.match(/^\s*(\d+)\.(.+?)\s+(?:\([^)]+\)\s+)?\((Attached|Detached)\)/i)
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

async function screenOutput(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(backendCommand(), backendArgs(args))
    return `${stdout}${stderr}`
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      const output = err as { stdout?: string; stderr?: string }
      return `${output.stdout ?? ''}${output.stderr ?? ''}`
    }
    return ''
  }
}

export async function listSessions(): Promise<ScreenSession[]> {
  const cleanupArgs = cleanupSessionsArgs()
  if (cleanupArgs) await screenOutput(cleanupArgs)
  const output = await screenOutput(listSessionsArgs())
  return terminalBackendKind() === 'tmux'
    ? parseTmuxList(output)
    : parseScreenList(output)
}

export async function createSession(name: string): Promise<void> {
  validateSessionName(name)
  if (await sessionExists(name)) {
    throw new Error(`Session "${name}" already exists`)
  }
  await execFileAsync(backendCommand(), backendArgs(createDetachedSessionArgs(name)))
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
  await execFileAsync(
    backendCommand(),
    backendArgs(killSessionArgs(session as TerminalSession)),
  )
}

export { parseTmuxList }
