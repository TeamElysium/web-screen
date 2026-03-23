'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { TerminalHandle } from '@/lib/terminal-client'

const MODIFIER_KEYS = ['Ctrl', 'Shift', 'Alt'] as const
const ACTION_KEYS = [
  { label: 'Esc', code: '\x1b' },
  { label: 'Tab', code: '\t' },
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

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const syncHeight = () => {
      const h = window.visualViewport?.height ?? window.innerHeight
      root.style.height = `${h}px`
    }
    syncHeight()

    window.visualViewport?.addEventListener('resize', syncHeight)
    return () => window.visualViewport?.removeEventListener('resize', syncHeight)
  }, [])

  useEffect(() => {
    if (!containerRef.current || !params.session) return

    import('@/lib/terminal-client').then(({ createTerminalConnection }) => {
      if (containerRef.current) {
        handleRef.current = createTerminalConnection(params.session, containerRef.current)
        const stored = sessionStorage.getItem('terminal-font-size')
        if (stored) {
          const size = parseInt(stored, 10)
          handleRef.current.setFontSize(size)
          setFontSizeState(size)
        }
      }
    }).catch(() => {
      setError('Failed to load terminal')
    })

    return () => {
      handleRef.current?.cleanup()
      handleRef.current = null
    }
  }, [params.session])

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
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
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
        className="flex flex-wrap gap-1 bg-gray-900 px-2 py-1"
        data-testid="virtual-keyboard"
      >
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
    </div>
  )
}
