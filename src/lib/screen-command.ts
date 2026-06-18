import { existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SCREEN_RC_CONTENT = 'truecolor on\n'
const SCREEN_RC_PATH = join(tmpdir(), 'web-screen-screenrc')

let screenRcReady = false

function ensureScreenRc(): string {
  if (!screenRcReady) {
    writeFileSync(SCREEN_RC_PATH, SCREEN_RC_CONTENT, { encoding: 'utf8', mode: 0o600 })
    screenRcReady = true
  }
  return SCREEN_RC_PATH
}

export function screenCommand(): string {
  if (process.env.SCREEN_BIN) return process.env.SCREEN_BIN
  if (process.platform === 'darwin') {
    for (const candidate of ['/opt/homebrew/bin/screen', '/usr/local/bin/screen']) {
      if (existsSync(candidate)) return candidate
    }
  }
  return 'screen'
}

export function screenArgs(args: string[]): string[] {
  return ['-c', ensureScreenRc(), ...args]
}
