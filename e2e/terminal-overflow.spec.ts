import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3389'

test.describe('Terminal overflow detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`)
    await page.fill('input[type="password"]', 'changeme')
    await page.click('button[type="submit"]')
    await page.waitForURL(`${BASE_URL}/`)
  })

  test('xterm container must not overflow', async ({ page }) => {
    const connectBtn = page.locator('button:has-text("Connect")').first()
    await connectBtn.click()
    await page.waitForSelector('.xterm', { timeout: 10000 })
    await page.waitForTimeout(2000)

    // 컨테이너 내부의 모든 직접 자식 + xterm 내부 구조 전체 덤프
    const info = await page.evaluate(() => {
      const container = document.querySelector('.absolute.inset-0') as HTMLElement
      if (!container) return { error: 'no container' }

      const childInfo = Array.from(container.children).map((child, i) => {
        const el = child as HTMLElement
        const cs = getComputedStyle(el)
        return {
          index: i,
          tag: el.tagName,
          class: el.className.substring(0, 60),
          offsetHeight: el.offsetHeight,
          scrollHeight: el.scrollHeight,
          overflow: cs.overflow,
          overflowY: cs.overflowY,
          position: cs.position,
          height: cs.height,
        }
      })

      // xterm 내부 자식들도
      const xtermEl = container.querySelector('.xterm') as HTMLElement
      const xtermChildren = xtermEl ? Array.from(xtermEl.children).map((child, i) => {
        const el = child as HTMLElement
        const cs = getComputedStyle(el)
        return {
          index: i,
          tag: el.tagName,
          class: el.className.substring(0, 60),
          offsetHeight: el.offsetHeight,
          scrollHeight: el.scrollHeight,
          overflow: cs.overflow,
          overflowY: cs.overflowY,
          position: cs.position,
          height: cs.height,
        }
      }) : []

      return {
        container: {
          offsetHeight: container.offsetHeight,
          scrollHeight: container.scrollHeight,
          childCount: container.children.length,
        },
        containerChildren: childInfo,
        xtermChildren,
        xtermStyle: xtermEl ? {
          height: xtermEl.style.height,
          overflow: xtermEl.style.overflow,
          computedHeight: getComputedStyle(xtermEl).height,
          computedOverflow: getComputedStyle(xtermEl).overflow,
        } : null,
      }
    })

    console.log('=== Full DOM dump ===')
    console.log(JSON.stringify(info, null, 2))

    // 수정 후: container scrollHeight가 offsetHeight에 근접해야 함
    const c = (info as any).container
    if (c) {
      expect(c.scrollHeight).toBeLessThanOrEqual(c.offsetHeight + 20)
    }
  })

  test('long output: 많은 출력 후에도 overflow 없어야 함', async ({ page }) => {
    const connectBtn = page.locator('button:has-text("Connect")').first()
    await connectBtn.click()
    await page.waitForSelector('.xterm', { timeout: 10000 })
    await page.waitForTimeout(2000)

    // screen 세션에 긴 출력 보내기
    await page.evaluate(() => {
      // xterm textarea에 포커스하고 명령 타이핑
      const textarea = document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
      if (textarea) textarea.focus()
    })

    // 500줄 출력
    await page.keyboard.type('for i in $(seq 1 500); do echo "line $i: AAAAAAAAAAAAAAAAAAAAAAAAAAAA"; done\n', { delay: 0 })
    await page.waitForTimeout(3000)

    const info = await page.evaluate(() => {
      const container = document.querySelector('.absolute.inset-0') as HTMLElement
      return {
        viewport: window.innerHeight,
        bodyScrollHeight: document.body.scrollHeight,
        bodyHasScroll: document.body.scrollHeight > window.innerHeight + 5,
        container: container ? {
          offsetHeight: container.offsetHeight,
          scrollHeight: container.scrollHeight,
        } : null,
      }
    })

    console.log('=== After long output ===')
    console.log(JSON.stringify(info, null, 2))

    expect(info.bodyHasScroll, `body scrolls after long output: ${info.bodyScrollHeight} > ${info.viewport}`).toBe(false)
    if (info.container) {
      expect(info.container.scrollHeight).toBeLessThanOrEqual(info.container.offsetHeight + 20)
    }
  })
})
