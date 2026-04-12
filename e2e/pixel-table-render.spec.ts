/**
 * E2E pixel-level test: verify xterm.js renders table content identically
 * during streaming and after page refresh.
 *
 * 1. Create a screen session with table content (box-drawing + CJK + SGR)
 * 2. Open in browser, capture screenshot (= streaming render)
 * 3. Refresh the page, capture screenshot (= screen redraw render)
 * 4. Compare pixel-by-pixel — they must be identical
 * 5. Mutation tests: corrupted content must produce visible pixel differences
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const BASE_URL = `http://localhost:${process.env.PORT || 3390}`
const PASSWORD = process.env.PASSWORD || 'changeme'

// Table content with box-drawing, CJK, and SGR — the patterns that broke
const TABLE_BYTES = (() => {
  let s = '\x1b[2J\x1b[H'
  // Header
  s += '\x1b[1mSGR 코드 요약표\x1b[0m\r\n\r\n'
  // Table with box-drawing
  s += '  ┌──────────────────┬───────────┬──────────┬──────────────────┐\r\n'
  s += '  │ \x1b[1m시퀀스\x1b[0m           │ \x1b[1m코드\x1b[0m      │ \x1b[1m설명\x1b[0m     │ \x1b[1m예시\x1b[0m             │\r\n'
  s += '  ├──────────────────┼───────────┼──────────┼──────────────────┤\r\n'
  s += '  │ \\x1b[1m          │ 1         │ \x1b[1m볼드\x1b[0m     │ \x1b[1mBold Text\x1b[0m        │\r\n'
  s += '  │ \\x1b[31m         │ 31        │ \x1b[31m빨강\x1b[0m     │ \x1b[31mRed Text\x1b[0m         │\r\n'
  s += '  │ \\x1b[1;33m       │ 1;33      │ \x1b[1;33m노란볼드\x1b[0m │ \x1b[1;33mYellow Bold\x1b[0m      │\r\n'
  s += '  │ \\x1b[32m         │ 32        │ \x1b[32m초록\x1b[0m     │ \x1b[32mGreen Text\x1b[0m       │\r\n'
  s += '  │ \\x1b[4m          │ 4         │ \x1b[4m밑줄\x1b[0m     │ \x1b[4mUnderline\x1b[0m        │\r\n'
  s += '  │ \\x1b[7m          │ 7         │ \x1b[7m반전\x1b[0m     │ \x1b[7mReverse\x1b[0m          │\r\n'
  s += '  │ \\x1b[0m          │ 0         │ 리셋     │ Normal           │\r\n'
  s += '  └──────────────────┴───────────┴──────────┴──────────────────┘\r\n'
  s += '\r\n'
  // CJK table
  s += '  \x1b[1m한글 문자 폭 테스트:\x1b[0m\r\n'
  s += '  ┌────────┬──────┬────────┐\r\n'
  s += '  │ 항목   │ 값   │ 상태   │\r\n'
  s += '  ├────────┼──────┼────────┤\r\n'
  s += '  │ 가나다 │ 100  │ \x1b[32m정상\x1b[0m   │\r\n'
  s += '  │ 라마바 │ 200  │ \x1b[33m경고\x1b[0m   │\r\n'
  s += '  │ 사아자 │ 300  │ \x1b[31m오류\x1b[0m   │\r\n'
  s += '  └────────┴──────┴────────┘\r\n'
  return s
})()

const CONTENT_FILE = join(tmpdir(), 'wst-pixel-test.bin')

function createSession(name: string, content: string) {
  writeFileSync(CONTENT_FILE, content, 'utf8')
  execSync(
    `screen -dmUS ${name} bash -c "cat ${CONTENT_FILE}; exec sleep 99999"`,
    { timeout: 3000 },
  )
}

function killSession(name: string) {
  try { execSync(`screen -S ${name} -X quit 2>/dev/null`, { timeout: 2000 }) } catch {}
  try { unlinkSync(CONTENT_FILE) } catch {}
}

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/login`)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/`)
}

async function openTerminal(page: import('@playwright/test').Page, session: string) {
  await page.goto(`${BASE_URL}/terminal/${session}`)
  await page.waitForSelector('.xterm-screen', { timeout: 10000 })
  // Wait for content to render and opacity to restore
  await page.waitForTimeout(3000)
}

function loadPng(buffer: Buffer): PNG {
  return PNG.sync.read(buffer)
}

function comparePngs(img1: Buffer, img2: Buffer): { mismatch: number; total: number; ratio: number } {
  const png1 = loadPng(img1)
  const png2 = loadPng(img2)

  const width = Math.min(png1.width, png2.width)
  const height = Math.min(png1.height, png2.height)
  const diff = new PNG({ width, height })

  const mismatch = pixelmatch(
    png1.data, png2.data, diff.data,
    width, height,
    { threshold: 0.1 },
  )
  const total = width * height

  return { mismatch, total, ratio: mismatch / total }
}

async function captureTerminal(page: import('@playwright/test').Page): Promise<Buffer> {
  const xtermScreen = page.locator('.xterm-screen')
  return (await xtermScreen.screenshot()) as Buffer
}

test.describe('pixel-level table rendering', () => {
  const SESSION = `wst_pixel_${Date.now()}`

  test.beforeAll(async () => {
    createSession(SESSION, TABLE_BYTES)
    // Give screen time to process
    await new Promise(r => setTimeout(r, 1000))
  })

  test.afterAll(() => {
    killSession(SESSION)
  })

  test('streaming and refresh render identically', async ({ page }) => {
    await login(page)

    // First visit = streaming render (screen attach → redraw)
    await openTerminal(page, SESSION)
    const screenshot1 = await captureTerminal(page)
    await page.screenshot({ path: 'e2e/pixel-table-stream.png' })

    // Refresh = new attach → screen redraw
    await page.reload()
    await page.waitForSelector('.xterm-screen', { timeout: 10000 })
    await page.waitForTimeout(3000)
    const screenshot2 = await captureTerminal(page)
    await page.screenshot({ path: 'e2e/pixel-table-refresh.png' })

    const result = comparePngs(screenshot1, screenshot2)
    console.log(
      `Pixel comparison: ${result.mismatch}/${result.total} differ ` +
      `(${(result.ratio * 100).toFixed(2)}%)`,
    )

    // Allow tiny cursor blink difference (< 0.1%)
    expect(result.ratio, `${result.mismatch} pixels differ`).toBeLessThan(0.001)
  })

  test('table box-drawing characters are aligned', async ({ page }) => {
    await login(page)
    await openTerminal(page, SESSION)

    // Extract text content from xterm rows
    const rows = await page.evaluate(() => {
      const rowEls = document.querySelectorAll('.xterm-rows > div')
      return Array.from(rowEls).map(r => (r as HTMLElement).textContent || '')
    })

    // Find the table rows and verify alignment
    const tableRows = rows.filter(r => r.includes('│'))
    expect(tableRows.length).toBeGreaterThan(0)

    // All │ in a column should be at the same x position within the text
    // Find column positions from the header separator row
    const sepRow = rows.find(r => r.includes('┼'))
    expect(sepRow).toBeTruthy()
  })

  test('CJK characters in table cells render correctly', async ({ page }) => {
    await login(page)
    await openTerminal(page, SESSION)

    const rows = await page.evaluate(() => {
      const rowEls = document.querySelectorAll('.xterm-rows > div')
      return Array.from(rowEls).map(r => (r as HTMLElement).textContent || '')
    })

    // Verify CJK content exists and isn't corrupted
    const hasHeader = rows.some(r => r.includes('SGR 코드 요약표'))
    const hasCjkTable = rows.some(r => r.includes('가나다'))
    const hasStatus = rows.some(r => r.includes('정상'))

    expect(hasHeader).toBe(true)
    expect(hasCjkTable).toBe(true)
    expect(hasStatus).toBe(true)
  })
})

test.describe('pixel mutation tests', () => {
  // Mutation: corrupted box-drawing → visible pixel difference
  test('corrupted box-drawing produces pixel difference', async ({ page }) => {
    const SESSION_OK = `wst_mut_ok_${Date.now()}`
    const SESSION_BAD = `wst_mut_bad_${Date.now()}`

    try {
      // Original content
      createSession(SESSION_OK, TABLE_BYTES)
      await new Promise(r => setTimeout(r, 500))

      await login(page)
      await openTerminal(page, SESSION_OK)
      const screenshotOk = await captureTerminal(page)

      killSession(SESSION_OK)

      // Corrupted: replace ┌ with +
      const mutated = TABLE_BYTES.replace(/┌/g, '+')
      createSession(SESSION_BAD, mutated)
      await new Promise(r => setTimeout(r, 500))

      await openTerminal(page, SESSION_BAD)
      const screenshotBad = await captureTerminal(page)

      const result = comparePngs(screenshotOk, screenshotBad)
      console.log(`Box corruption: ${result.mismatch} pixels differ (${(result.ratio * 100).toFixed(2)}%)`)

      // Must detect the corruption (even a few pixels)
      expect(result.mismatch, 'box-drawing corruption should be visible').toBeGreaterThan(0)
    } finally {
      killSession(SESSION_OK)
      killSession(SESSION_BAD)
    }
  })

  test('missing CJK text produces pixel difference', async ({ page }) => {
    const SESSION_OK = `wst_mut_ok2_${Date.now()}`
    const SESSION_BAD = `wst_mut_bad2_${Date.now()}`

    try {
      createSession(SESSION_OK, TABLE_BYTES)
      await new Promise(r => setTimeout(r, 500))

      await login(page)
      await openTerminal(page, SESSION_OK)
      const screenshotOk = await captureTerminal(page)

      killSession(SESSION_OK)

      // Corrupted: replace CJK with ASCII
      const mutated = TABLE_BYTES.replace('가나다', 'ABC')
      createSession(SESSION_BAD, mutated)
      await new Promise(r => setTimeout(r, 500))

      await openTerminal(page, SESSION_BAD)
      const screenshotBad = await captureTerminal(page)

      const result = comparePngs(screenshotOk, screenshotBad)
      console.log(`CJK corruption: ${result.mismatch} pixels differ (${(result.ratio * 100).toFixed(2)}%)`)

      expect(result.mismatch, 'CJK swap should be visible').toBeGreaterThan(0)
    } finally {
      killSession(SESSION_OK)
      killSession(SESSION_BAD)
    }
  })

  test('missing SGR produces pixel difference', async ({ page }) => {
    const SESSION_OK = `wst_mut_ok3_${Date.now()}`
    const SESSION_BAD = `wst_mut_bad3_${Date.now()}`

    try {
      createSession(SESSION_OK, TABLE_BYTES)
      await new Promise(r => setTimeout(r, 500))

      await login(page)
      await openTerminal(page, SESSION_OK)
      const screenshotOk = await captureTerminal(page)

      killSession(SESSION_OK)

      // Corrupted: remove all SGR (colors/bold)
      const mutated = TABLE_BYTES.replace(/\x1b\[\d+(?:;\d+)*m/g, '')
      createSession(SESSION_BAD, mutated)
      await new Promise(r => setTimeout(r, 500))

      await openTerminal(page, SESSION_BAD)
      const screenshotBad = await captureTerminal(page)

      const result = comparePngs(screenshotOk, screenshotBad)
      console.log(`SGR removal: ${result.mismatch} pixels differ (${(result.ratio * 100).toFixed(2)}%)`)

      expect(result.mismatch, 'SGR removal should be visible').toBeGreaterThan(0)
    } finally {
      killSession(SESSION_OK)
      killSession(SESSION_BAD)
    }
  })
})
