'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { TerminalHandle } from '@/lib/terminal-client'

const MODIFIER_KEYS = ['Ctrl', 'Shift', 'Alt'] as const
const ACTION_KEYS = [
  { label: 'Tab', code: '\t' },
  { label: 'Esc', code: '\x1b' },
  { label: 'Enter', code: '\r' },
  { label: '↑', code: '\x1b[A' },
  { label: '↓', code: '\x1b[B' },
  { label: '←', code: '\x1b[D' },
  { label: '→', code: '\x1b[C' },
] as const

export default function TerminalPage() {
  const params = useParams<{ session: string }>()
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<TerminalHandle | null>(null)
  const [error, setError] = useState('')
  const [modifiers, setModifiers] = useState({ Ctrl: false, Shift: false, Alt: false })
  const [selectMode, setSelectMode] = useState(false)
  const [bufferText, setBufferText] = useState('')
  const [fontSize, setFontSizeState] = useState(14)
  const rootRef = useRef<HTMLDivElement>(null)
  const repeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks whether the OS keyboard is currently covering part of the screen.
  // Derived from visualViewport.resize — see the sync effect below.
  const isKeyboardVisibleRef = useRef(false)

  // Mobile: xterm's hidden helper-textarea stays focused after the user
  // dismisses the OS keyboard. Any subsequent tap on a focused text input
  // re-shows the keyboard. Scroll buttons are a scroll gesture, not typing,
  // so when the OS keyboard is already DOWN we pre-emptively blur the focused
  // text input to stop the OS from re-showing it. If the keyboard is currently
  // UP the user is actively typing — leave focus alone and just scroll.
  const dismissKeyboardIfHidden = useCallback(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) return
    // Only relevant on touch devices; desktops have no OS keyboard and
    // blurring would needlessly drop terminal focus.
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints === 0) return
    if (isKeyboardVisibleRef.current) return
    active.blur()
  }, [])

  const startRepeat = useCallback((fn: () => void) => {
    fn()
    const stop = () => {
      if (repeatTimer.current) { clearTimeout(repeatTimer.current); repeatTimer.current = null }
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    // Initial delay before repeating
    repeatTimer.current = setTimeout(function tick() {
      fn()
      repeatTimer.current = setTimeout(tick, 80)
    }, 300)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const vv = window.visualViewport
    // Baseline = the largest visual-viewport height we have ever observed,
    // i.e. the height when no OS keyboard is present. Platform-agnostic:
    // works on iOS (innerHeight constant) and Android (innerHeight shrinks
    // in sync with visualViewport) alike.
    let baselineHeight = vv?.height ?? window.innerHeight

    const sync = () => {
      const h = vv?.height ?? window.innerHeight
      if (h > baselineHeight) baselineHeight = h
      isKeyboardVisibleRef.current = baselineHeight - h > 150
      root.style.height = `${h}px`
    }
    sync()

    vv?.addEventListener('resize', sync)
    return () => vv?.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    if (!containerRef.current || !params.session) return

    let cancelled = false

    import('@/lib/terminal-client').then(({ createTerminalConnection }) => {
      if (cancelled || !containerRef.current) return
      handleRef.current = createTerminalConnection(params.session, containerRef.current)
      const stored = sessionStorage.getItem('terminal-font-size')
      if (stored) {
        const size = parseInt(stored, 10)
        handleRef.current.setFontSize(size)
        setFontSizeState(size)
      }
    }).catch((err) => {
      console.error('Failed to load terminal:', err)
      setError(`Failed to load terminal: ${err?.message ?? err}`)
    })

    return () => {
      cancelled = true
      handleRef.current?.cleanup()
      handleRef.current = null
    }
  }, [params.session])

  const modifiersRef = useRef(modifiers)
  modifiersRef.current = modifiers

  // Apply virtual modifiers to physical keyboard input
  useEffect(() => {
    const h = handleRef.current
    if (!h) return
    h.onBeforeInput = (data: string) => {
      const mods = modifiersRef.current
      if (!mods.Ctrl && !mods.Alt && !mods.Shift) return data

      let out = data
      if (mods.Shift && data.length === 1) {
        out = data.toUpperCase()
      }
      if (mods.Alt) {
        out = '\x1b' + out
      }
      if (mods.Ctrl && data.length === 1) {
        const upper = data.toUpperCase()
        if (upper >= 'A' && upper <= 'Z') {
          out = String.fromCharCode(upper.charCodeAt(0) - 64)
        }
      }
      setModifiers({ Ctrl: false, Shift: false, Alt: false })
      return out
    }
    return () => { h.onBeforeInput = null }
  })

  const toggleModifier = useCallback((key: typeof MODIFIER_KEYS[number]) => {
    setModifiers(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const sendKey = useCallback((code: string) => {
    if (!handleRef.current) return

    let out = code
    if (modifiers.Shift && code.length === 1) {
      out = code.toUpperCase()
    }
    if (modifiers.Alt) {
      out = '\x1b' + out
    }
    if (modifiers.Ctrl && code.length === 1) {
      // Ctrl+<letter> = char code 1-26
      const upper = code.toUpperCase()
      if (upper >= 'A' && upper <= 'Z') {
        out = String.fromCharCode(upper.charCodeAt(0) - 64)
      }
    }

    handleRef.current.sendInput(out)
    setModifiers({ Ctrl: false, Shift: false, Alt: false })
  }, [modifiers])

  const changeFontSize = useCallback((delta: number) => {
    if (!handleRef.current) return
    const current = handleRef.current.getFontSize()
    const next = current + delta
    if (next < 8 || next > 32) return
    handleRef.current.setFontSize(next)
    setFontSizeState(next)
    sessionStorage.setItem('terminal-font-size', String(next))
  }, [])

  const toggleSelectMode = useCallback(() => {
    if (!selectMode && handleRef.current) {
      setBufferText(handleRef.current.getBufferText())
    }
    setSelectMode(prev => !prev)
  }, [selectMode])

  if (error) {
    return <div className="p-8 text-red-500">{error}</div>
  }

  return (
    <div ref={rootRef} className="flex h-dvh w-screen flex-col bg-black overflow-hidden">
      <div className="flex select-none items-center justify-between bg-gray-900 px-2 py-1" data-testid="terminal-header">
        <button
          data-testid="btn-sessions"
          onClick={() => router.push('/')}
          className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 active:bg-gray-600"
        >
          Sessions
        </button>
        <span className="min-w-0 truncate text-xs text-gray-500">{params.session}</span>
        <button
          data-testid="btn-fullscreen"
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen()
            } else {
              rootRef.current?.requestFullscreen()
            }
          }}
          className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 active:bg-gray-600"
        >
          Fullscreen
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={containerRef} className="absolute inset-0 overflow-hidden" />
        {selectMode && (
          <div
            className="absolute inset-0 overflow-auto bg-black/90 p-2"
            data-testid="select-overlay"
          >
            <pre className="whitespace-pre-wrap break-all font-mono text-sm text-green-400 select-text">
              {bufferText}
            </pre>
          </div>
        )}
      </div>
      <div
        className="flex select-none items-stretch bg-gray-900"
        data-testid="virtual-keyboard"
      >
        <div className="flex flex-1 flex-wrap gap-1 px-2 py-1">
          <button
            data-testid="vk-Select"
            onPointerDown={(e) => { e.preventDefault(); toggleSelectMode() }}
            className={`rounded px-3 py-1 text-xs font-bold ${
              selectMode
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300'
            }`}
          >
            Select
          </button>
          <button
            data-testid="vk-font-down"
            onPointerDown={(e) => { e.preventDefault(); changeFontSize(-2) }}
            className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 active:bg-gray-600"
          >
            A-
          </button>
          <span
            data-testid="vk-font-size"
            className="px-1 py-1 text-xs text-gray-400"
          >
            {fontSize}
          </span>
          <button
            data-testid="vk-font-up"
            onPointerDown={(e) => { e.preventDefault(); changeFontSize(2) }}
            className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 active:bg-gray-600"
          >
            A+
          </button>
          <span className="mx-1" />
          {MODIFIER_KEYS.map((key) => (
            <button
              key={key}
              data-testid={`vk-${key}`}
              onPointerDown={(e) => { e.preventDefault(); toggleModifier(key) }}
              className={`rounded px-3 py-1 text-xs font-bold ${
                modifiers[key]
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300'
              }`}
            >
              {key}
            </button>
          ))}
          <span className="mx-1" />
          {ACTION_KEYS.map((key) => (
            <button
              key={key.label}
              data-testid={`vk-${key.label}`}
              onPointerDown={(e) => { e.preventDefault(); sendKey(key.code) }}
              className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 active:bg-gray-600"
            >
              {key.label}
            </button>
          ))}
        </div>
        <div
          className="flex shrink-0 flex-row border-l border-gray-800"
          data-testid="vk-scroll-controls"
        >
          <button
            data-testid="vk-scroll-up"
            onPointerDown={(e) => { e.preventDefault(); dismissKeyboardIfHidden(); startRepeat(() => handleRef.current?.scrollUp()) }}
            className="flex w-11 items-center justify-center px-2 py-2 text-base leading-none text-gray-300 active:bg-gray-700"
          >
            ▲
          </button>
          <button
            data-testid="vk-scroll-down"
            onPointerDown={(e) => { e.preventDefault(); dismissKeyboardIfHidden(); startRepeat(() => handleRef.current?.scrollDown()) }}
            className="flex w-11 items-center justify-center border-l border-gray-800 px-2 py-2 text-base leading-none text-gray-300 active:bg-gray-700"
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  )
}
