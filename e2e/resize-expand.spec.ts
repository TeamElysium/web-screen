import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

const BASE_URL = 'http://localhost:3389'
const SESSION = 'pw_resize_expand'

function screenStuff(cmd: string) {
  execSync(`screen -S ${SESSION} -p 0 -X stuff $'${cmd}\\n'`)
}

function readBufferLines(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('.xterm-rows > div')
    return Array.from(rows).map(r => (r as HTMLElement).innerText.trimEnd())
  })
}

test.describe('resize expand: cols sync verification', () => {
  test.beforeEach(() => {
    try { execSync(`screen -S ${SESSION} -X quit`, { stdio: 'ignore' }) } catch {}
    execSync(`screen -dmS ${SESSION}`)
  })

  test.afterEach(() => {
    try { execSync(`screen -S ${SESSION} -X quit`, { stdio: 'ignore' }) } catch {}
  })

  test('after expand, tput cols reflects larger viewport', async ({ page }) => {
    // Login
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="password"]', 'changeme')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE_URL}/`)

    // Start at 800px width
    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto(`${BASE_URL}/terminal/${SESSION}`)
    await page.waitForSelector('.xterm', { timeout: 10000 })
    await page.waitForTimeout(2000)

    // Record initial cols
    screenStuff('echo INIT_COLS=$(tput cols)')
    await page.waitForTimeout(500)

    // Shrink to 600px
    await page.setViewportSize({ width: 600, height: 600 })
    await page.waitForTimeout(500)
    screenStuff('echo SHRUNK_COLS=$(tput cols)')
    await page.waitForTimeout(500)

    // Expand to 1200px (larger than initial)
    await page.setViewportSize({ width: 1200, height: 600 })
    await page.waitForTimeout(500)
    screenStuff('echo EXPAND_COLS=$(tput cols)')
    await page.waitForTimeout(500)

    // Read buffer
    const lines = await readBufferLines(page)
    const text = lines.join('\n')

    const initCols = parseInt(text.match(/INIT_COLS=(\d+)/)?.[1] || '0')
    const shrunkCols = parseInt(text.match(/SHRUNK_COLS=(\d+)/)?.[1] || '0')
    const expandCols = parseInt(text.match(/EXPAND_COLS=(\d+)/)?.[1] || '0')

    console.log(`COLS: init=${initCols} shrunk=${shrunkCols} expand=${expandCols}`)

    expect(shrunkCols, 'shrink should reduce cols').toBeLessThan(initCols)
    expect(expandCols, 'expand should increase cols beyond shrunk').toBeGreaterThan(shrunkCols)
    expect(expandCols, 'expand should exceed initial (wider viewport)').toBeGreaterThan(initCols)
  })

  test('after expand, ruler line fits on single row', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="password"]', 'changeme')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE_URL}/`)

    await page.setViewportSize({ width: 800, height: 600 })
    await page.goto(`${BASE_URL}/terminal/${SESSION}`)
    await page.waitForSelector('.xterm', { timeout: 10000 })
    await page.waitForTimeout(2000)

    // Shrink then expand
    await page.setViewportSize({ width: 600, height: 600 })
    await page.waitForTimeout(500)
    await page.setViewportSize({ width: 1200, height: 600 })
    await page.waitForTimeout(500)

    // Clear and output a 100-char ruler
    screenStuff('clear')
    await page.waitForTimeout(300)
    screenStuff('printf "R:%098s:E\\n" "" | tr " " "X"')
    await page.waitForTimeout(500)

    const lines = await readBufferLines(page)

    // At 1200px, cols should be ~140+, so 100-char ruler fits on one line
    // If cols stuck at ~70 (600px), it wraps
    const rulerLine = lines.find(l => l.includes('R:') && l.includes(':E'))
    expect(rulerLine, 'ruler should fit on a single line after expand').toBeTruthy()

    const expectedRuler = 'R:' + 'X'.repeat(98) + ':E'
    expect(rulerLine!.trim()).toContain(expectedRuler)

    await page.screenshot({ path: 'e2e/resize-expand-ruler.png' })
  })
})
