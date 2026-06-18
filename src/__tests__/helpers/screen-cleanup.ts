import { execFileSync } from 'child_process'
import { screenArgs, screenCommand } from '@/lib/screen-command'

const trackedSessions: string[] = []

export function trackSession(name: string): void {
  trackedSessions.push(name)
}

export function forceKillSession(name: string): void {
  try {
    const output = execFileSync(screenCommand(), screenArgs(['-ls']), { encoding: 'utf8' })
    for (const line of output.split('\n')) {
      if (line.includes(name)) {
        const match = line.match(/\t(\d+)\./)
        if (match) try { process.kill(Number(match[1]), 'SIGKILL') } catch { /* */ }
      }
    }
  } catch { /* */ }
}

export function cleanupTrackedSessions(): void {
  for (const name of trackedSessions) {
    forceKillSession(name)
  }
  trackedSessions.length = 0
  try { execFileSync(screenCommand(), screenArgs(['-wipe'])) } catch { /* */ }
}
