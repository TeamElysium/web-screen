/**
 * @vitest-environment node
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { parseScreenList, listSessions, createSession, sessionExists, killSession as killScreenSession } from '@/lib/screen-manager'
import { trackSession, cleanupTrackedSessions } from './helpers/screen-cleanup'

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

  it('parses GNU screen output with timestamp columns', () => {
    const output = `There are screens on:
\t1787643.Webscreen\t(06/02/26 19:45:49)\t(Attached)
\t1782416.Codex2\t(06/02/26 19:43:13)\t(Detached)
2 Sockets in /run/screen/S-ely.\n`
    const result = parseScreenList(output)
    expect(result).toEqual([
      { id: '1787643', name: 'Webscreen', status: 'attached' },
      { id: '1782416', name: 'Codex2', status: 'detached' },
    ])
  })

  it('ignores dead GNU screen sockets', () => {
    const output = `There are screens on:
\t1782416.Codex2\t(06/02/26 19:43:13)\t(Detached)
\t15084.pts-0.ely-gpu3\t(02/10/26 12:43:01)\t(Dead ???)
Remove dead screens with 'screen -wipe'.
2 Sockets in /run/screen/S-ely.\n`
    const result = parseScreenList(output)
    expect(result).toEqual([
      { id: '1782416', name: 'Codex2', status: 'detached' },
    ])
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

afterEach(() => {
  cleanupTrackedSessions()
})

afterAll(() => {
  cleanupTrackedSessions()
})

describe('screen-manager integration', () => {
  it('createSession creates a detached screen session', async () => {
    const name = uniqueName('create')
    trackSession(name)
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
    trackSession(name)
    await createSession(name)
    expect(await sessionExists(name)).toBe(true)
  })

  it('sessionExists returns false for non-existing session', async () => {
    expect(await sessionExists(uniqueName('nonexistent'))).toBe(false)
  })

  it('createSession throws on duplicate name', async () => {
    const name = uniqueName('dup')
    trackSession(name)
    await createSession(name)
    await expect(createSession(name)).rejects.toThrow()
  })

  it('killSession removes an existing session', async () => {
    const name = uniqueName('kill')
    trackSession(name)
    await createSession(name)
    expect(await sessionExists(name)).toBe(true)
    await killScreenSession(name)
    await new Promise(r => setTimeout(r, 200))
    expect(await sessionExists(name)).toBe(false)
  })

  it('killSession throws for non-existing session', async () => {
    await expect(killScreenSession(uniqueName('ghost'))).rejects.toThrow('not found')
  })
})
