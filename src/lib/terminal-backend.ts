import { existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { screenArgs, screenCommand } from './screen-command'

export type TerminalBackendKind = 'tmux' | 'screen'

export interface TerminalSession {
  id: string
  name: string
  status: 'attached' | 'detached'
}

export interface AttachSpec {
  command: string
  args: string[]
  cols: number
  rows: number
  discardInitialOutput: boolean
  resizeAfterAttach: boolean
}

const TMUX_CONF_CONTENT = [
  'set -g status off',
  'set -g mouse on',
  'set -g default-terminal "tmux-256color"',
  'set -as terminal-features ",xterm-256color:RGB"',
  'set -as terminal-features ",xterm-256color:sync"',
  'set -g focus-events on',
  'set -g escape-time 10',
  '',
].join('\n')
const TMUX_CONF_PATH = join(tmpdir(), 'web-screen-tmux.conf')

let tmuxConfReady = false

function ensureTmuxConf(): string {
  if (!tmuxConfReady) {
    writeFileSync(TMUX_CONF_PATH, TMUX_CONF_CONTENT, { encoding: 'utf8', mode: 0o600 })
    tmuxConfReady = true
  }
  return TMUX_CONF_PATH
}

export function terminalBackendKind(): TerminalBackendKind {
  const backend = process.env.TERMINAL_BACKEND?.toLowerCase()
  if (backend === 'screen') return 'screen'
  return 'tmux'
}

export function tmuxCommand(): string {
  if (process.env.TMUX_BIN) return process.env.TMUX_BIN
  if (process.platform === 'darwin') {
    for (const candidate of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux']) {
      if (existsSync(candidate)) return candidate
    }
  }
  return 'tmux'
}

export function tmuxArgs(args: string[]): string[] {
  const prefix: string[] = []
  const socketName = process.env.TMUX_SOCKET_NAME

  if (socketName) {
    prefix.push('-L', socketName)
    prefix.push('-f', process.env.TMUX_CONFIG || ensureTmuxConf())
  } else if (process.env.TMUX_CONFIG) {
    prefix.push('-f', process.env.TMUX_CONFIG)
  }

  return [...prefix, ...args]
}

export function backendCommand(): string {
  return terminalBackendKind() === 'tmux' ? tmuxCommand() : screenCommand()
}

export function backendArgs(args: string[]): string[] {
  return terminalBackendKind() === 'tmux' ? tmuxArgs(args) : screenArgs(args)
}

export function parseTmuxList(output: string): TerminalSession[] {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = '', name = '', attached = '0'] = line.split('\t')
      if (!id || !name) return null
      return {
        id,
        name,
        status: attached === '0' || attached === 'detached' ? 'detached' : 'attached',
      } satisfies TerminalSession
    })
    .filter((session): session is TerminalSession => session !== null)
}

export function listSessionsArgs(): string[] {
  if (terminalBackendKind() === 'tmux') {
    return ['list-sessions', '-F', '#{session_id}\t#{session_name}\t#{session_attached}']
  }
  return ['-ls']
}

export function cleanupSessionsArgs(): string[] | null {
  return terminalBackendKind() === 'screen' ? ['-wipe'] : null
}

export function createDetachedSessionArgs(name: string): string[] {
  if (terminalBackendKind() === 'tmux') {
    return ['new-session', '-d', '-s', name]
  }
  return ['-dmUS', name]
}

export function killSessionArgs(session: TerminalSession): string[] {
  if (terminalBackendKind() === 'tmux') {
    return ['kill-session', '-t', session.name]
  }
  return ['-S', `${session.id}.${session.name}`, '-X', 'quit']
}

export function prepareAttachArgs(session: string): string[] | null {
  if (terminalBackendKind() === 'tmux') return null
  return ['-S', session, '-X', 'utf8', 'on']
}

export function attachSpec(session: string, cols: number, rows: number): AttachSpec {
  if (terminalBackendKind() === 'tmux') {
    return {
      command: tmuxCommand(),
      args: tmuxArgs(['attach-session', '-t', session]),
      cols,
      rows,
      discardInitialOutput: false,
      resizeAfterAttach: false,
    }
  }

  return {
    command: screenCommand(),
    args: screenArgs(['-xU', session]),
    cols: Math.max(cols - 1, 1),
    rows,
    discardInitialOutput: true,
    resizeAfterAttach: true,
  }
}

export function detachSequence(): string {
  return terminalBackendKind() === 'tmux' ? '\x02d' : '\x01d'
}

export function resizeSessionArgs(session: string, cols: number, rows: number): string[] {
  if (terminalBackendKind() === 'tmux') {
    return ['resize-window', '-t', `${session}:0`, '-x', String(cols), '-y', String(rows)]
  }
  return ['-S', session, '-X', 'redisplay']
}

export type ScrollDirection = 'up' | 'down'

export function scrollSessionArgs(session: string, direction: ScrollDirection): string[] | null {
  if (terminalBackendKind() !== 'tmux') return null

  const target = `${session}:0.0`
  if (direction === 'up') {
    return ['copy-mode', '-u', '-t', target]
  }

  return ['send-keys', '-t', target, '-X', 'page-down']
}

export function scrollPositionArgs(session: string): string[] | null {
  if (terminalBackendKind() !== 'tmux') return null
  return ['display-message', '-p', '-t', `${session}:0.0`, '#{pane_in_mode} #{scroll_position}']
}

export function cancelScrollArgs(session: string): string[] | null {
  if (terminalBackendKind() !== 'tmux') return null
  return ['send-keys', '-t', `${session}:0.0`, '-X', 'cancel']
}
