import { describe, it, expect, afterAll } from 'vitest'
import { parseScreenList, listSessions, createSession, sessionExists, killSession as killScreenSession } from '@/lib/screen-manager'
import { execSync } from 'child_process'

// --- Unit tests: parseScreenList ---

describe('parseScreenList', () => {
  it('parses empty output (no sessions)', () => {
    const output = 'No Sockets found in /var/folders/xx/.screen.\n'
    expect(parseScreenList(output)).toEqual([])
  })

  it('parses single detached session', () => {
    const output = `There are screens on:
\t12345.my_session\t(Detached)
1 Socket in /var/folders/xx/.screen.\n`
    const result = parseScreenList(output)
    expect(result).toEqual([
      { id: '12345', name: 'my_session', status: 'detached' },
    ])
  })

  it('parses multiple sessions with mixed status', () => {
    const output = `There are screens on:
\t99999.session_a\t(Attached)
\t88888.session_b\t(Detached)
2 Sockets in /var/folders/xx/.screen.\n`
    const result = parseScreenList(output)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: '99999', name: 'session_a', status: 'attached' })
    expect(result[1]).toEqual({ id: '88888', name: 'session_b', status: 'detached' })
  })

  it('handles session names with dots', () => {
    const output = `There are screens on:
\t11111.my.dotted.name\t(Detached)
1 Socket in /var/folders/xx/.screen.\n`
    const result = parseScreenList(output)
    expect(result).toEqual([
      { id: '11111', name: 'my.dotted.name', status: 'detached' },
    ])
  })
})

// --- Integration tests: real screen commands ---

const TEST_PREFIX = 'wst_'
let testCounter = 0

function uniqueName(label: string): string {
  return `${TEST_PREFIX}${Date.now()}_${testCounter++}_${label}`
}

const createdSessions: string[] = []

function killSession(name: string) {
  try {
    const output = execSync('screen -ls 2>&1').toString()
    const lines = output.split('\n')
    for (const line of lines) {
      if (line.includes(name)) {
        const match = line.match(/\t(\d+)\./)
        if (match) {
          try { execSync(`kill -9 ${match[1]} 2>&1`) } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
}

afterAll(() => {
  for (const name of createdSessions) {
    killSession(name)
  }
  try { execSync('screen -wipe 2>&1') } catch { /* ignore */ }
})

describe('screen-manager integration', () => {
  it('createSession creates a detached screen session', async () => {
    const name = uniqueName('create')
    createdSessions.push(name)
    await createSession(name)
    const sessions = await listSessions()
    const found = sessions.find(s => s.name === name)
    expect(found).toBeDefined()
    expect(found!.status).toBe('detached')
  })

  it('listSessions returns an array', async () => {
    const sessions = await listSessions()
    expect(Array.isArray(sessions)).toBe(true)
  })

  it('sessionExists returns true for existing session', async () => {
    const name = uniqueName('exists')
    createdSessions.push(name)
    await createSession(name)
    expect(await sessionExists(name)).toBe(true)
  })

  it('sessionExists returns false for non-existing session', async () => {
    expect(await sessionExists(uniqueName('nonexistent'))).toBe(false)
  })

  it('createSession throws on duplicate name', async () => {
    const name = uniqueName('dup')
    createdSessions.push(name)
    await createSession(name)
    await expect(createSession(name)).rejects.toThrow()
  })

  it('killSession removes an existing session', async () => {
    const name = uniqueName('kill')
    createdSessions.push(name)
    await createSession(name)
    expect(await sessionExists(name)).toBe(true)
    await killScreenSession(name)
    // Give screen a moment to clean up
    await new Promise(r => setTimeout(r, 200))
    expect(await sessionExists(name)).toBe(false)
  })

  it('killSession throws for non-existing session', async () => {
    await expect(killScreenSession(uniqueName('ghost'))).rejects.toThrow('not found')
  })
})
