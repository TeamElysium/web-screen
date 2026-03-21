import { execSync } from 'child_process'

const trackedSessions: string[] = []

export function trackSession(name: string): void {
  trackedSessions.push(name)
}

export function forceKillSession(name: string): void {
  try {
    const output = execSync('screen -ls 2>&1').toString()
    for (const line of output.split('\n')) {
      if (line.includes(name)) {
        const match = line.match(/\t(\d+)\./)
        if (match) try { execSync(`kill -9 ${match[1]} 2>&1`) } catch { /* */ }
      }
    }
  } catch { /* */ }
}

export function cleanupTrackedSessions(): void {
  for (const name of trackedSessions) {
    forceKillSession(name)
  }
  trackedSessions.length = 0
  try { execSync('screen -wipe 2>&1') } catch { /* */ }
}
