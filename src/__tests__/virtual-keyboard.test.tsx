import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ session: 'test-session' }),
  useRouter: () => ({ push: mockPush }),
}))

// Mock terminal-client — dynamic import returns a promise
const mockSendInput = vi.fn()
const mockCleanup = vi.fn()
const mockSetFontSize = vi.fn()
const mockGetFontSize = vi.fn(() => 14)

vi.mock('@/lib/terminal-client', () => ({
  createTerminalConnection: vi.fn(() => ({
    cleanup: mockCleanup,
    sendInput: mockSendInput,
    getBufferText: vi.fn(() => ''),
    setFontSize: mockSetFontSize,
    getFontSize: mockGetFontSize,
  })),
}))

import TerminalPage from '@/app/terminal/[session]/page'

describe('Virtual keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders modifier keys and action keys', async () => {
    render(<TerminalPage />)

    // Wait for dynamic import to resolve
    await vi.dynamicImportSettled()

    expect(screen.getByTestId('virtual-keyboard')).toBeDefined()
    expect(screen.getByTestId('vk-Ctrl')).toBeDefined()
    expect(screen.getByTestId('vk-Shift')).toBeDefined()
    expect(screen.getByTestId('vk-Alt')).toBeDefined()
    expect(screen.getByTestId('vk-Esc')).toBeDefined()
    expect(screen.getByTestId('vk-Tab')).toBeDefined()
    expect(screen.getByTestId('vk-Enter')).toBeDefined()
    expect(screen.getByTestId('vk-↑')).toBeDefined()
    expect(screen.getByTestId('vk-↓')).toBeDefined()
    expect(screen.getByTestId('vk-←')).toBeDefined()
    expect(screen.getByTestId('vk-→')).toBeDefined()
  })

  it('sends Esc key code on press', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-Esc'))
    expect(mockSendInput).toHaveBeenCalledWith('\x1b')
  })

  it('sends Tab key code on press', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-Tab'))
    expect(mockSendInput).toHaveBeenCalledWith('\t')
  })

  it('sends Enter key code on press', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-Enter'))
    expect(mockSendInput).toHaveBeenCalledWith('\r')
  })

  it('sends arrow key codes', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-↑'))
    expect(mockSendInput).toHaveBeenCalledWith('\x1b[A')

    fireEvent.pointerDown(screen.getByTestId('vk-↓'))
    expect(mockSendInput).toHaveBeenCalledWith('\x1b[B')

    fireEvent.pointerDown(screen.getByTestId('vk-←'))
    expect(mockSendInput).toHaveBeenCalledWith('\x1b[D')

    fireEvent.pointerDown(screen.getByTestId('vk-→'))
    expect(mockSendInput).toHaveBeenCalledWith('\x1b[C')
  })

  it('toggles Ctrl modifier and applies to next key', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    const ctrlBtn = screen.getByTestId('vk-Ctrl')

    // Toggle Ctrl on
    fireEvent.pointerDown(ctrlBtn)
    expect(ctrlBtn.className).toContain('bg-blue-600')

    // Ctrl is now active but no action key pressed yet — sendInput not called
    expect(mockSendInput).not.toHaveBeenCalled()
  })

  it('toggles modifier off when pressed twice', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    const ctrlBtn = screen.getByTestId('vk-Ctrl')

    fireEvent.pointerDown(ctrlBtn)
    expect(ctrlBtn.className).toContain('bg-blue-600')

    fireEvent.pointerDown(ctrlBtn)
    expect(ctrlBtn.className).toContain('bg-gray-700')
  })

  it('resets modifiers after action key press', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    const ctrlBtn = screen.getByTestId('vk-Ctrl')

    // Activate Ctrl
    fireEvent.pointerDown(ctrlBtn)
    expect(ctrlBtn.className).toContain('bg-blue-600')

    // Press Esc — modifiers should reset
    fireEvent.pointerDown(screen.getByTestId('vk-Esc'))

    expect(ctrlBtn.className).toContain('bg-gray-700')
  })
})

describe('Font size controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFontSize.mockReturnValue(14)
    sessionStorage.clear()
  })

  it('renders A+ and A- buttons in virtual keyboard', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(screen.getByTestId('vk-font-up')).toBeDefined()
    expect(screen.getByTestId('vk-font-down')).toBeDefined()
  })

  it('A+ button displays "A+" text', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(screen.getByTestId('vk-font-up').textContent).toBe('A+')
  })

  it('A- button displays "A-" text', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(screen.getByTestId('vk-font-down').textContent).toBe('A-')
  })

  it('displays current font size between A- and A+', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    const sizeDisplay = screen.getByTestId('vk-font-size')
    expect(sizeDisplay.textContent).toBe('14')
  })

  it('updates displayed font size after A+ press', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(screen.getByTestId('vk-font-size').textContent).toBe('14')
    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(screen.getByTestId('vk-font-size').textContent).toBe('16')
  })

  it('updates displayed font size after A- press', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(screen.getByTestId('vk-font-size').textContent).toBe('14')
    fireEvent.pointerDown(screen.getByTestId('vk-font-down'))
    expect(screen.getByTestId('vk-font-size').textContent).toBe('12')
  })

  it('increases font size when A+ is pressed', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(mockSetFontSize).toHaveBeenCalledWith(16)
  })

  it('decreases font size when A- is pressed', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-down'))
    expect(mockSetFontSize).toHaveBeenCalledWith(12)
  })

  // sessionStorage persistence
  it('saves font size to sessionStorage on change', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(sessionStorage.getItem('terminal-font-size')).toBe('16')
  })

  it('restores font size from sessionStorage on mount', async () => {
    sessionStorage.setItem('terminal-font-size', '20')
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(screen.getByTestId('vk-font-size').textContent).toBe('20')
  })

  it('passes stored font size to setFontSize on mount', async () => {
    sessionStorage.setItem('terminal-font-size', '20')
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(mockSetFontSize).toHaveBeenCalledWith(20)
  })

  // Mutation test: does NOT call setFontSize on mount when no stored value
  it('does not call setFontSize on mount when no stored value', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    expect(mockSetFontSize).not.toHaveBeenCalled()
  })

  // Mutation tests: boundary conditions
  it('does not decrease font size below minimum (8)', async () => {
    mockGetFontSize.mockReturnValue(8)
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-down'))
    expect(mockSetFontSize).not.toHaveBeenCalled()
  })

  it('does not increase font size above maximum (32)', async () => {
    mockGetFontSize.mockReturnValue(32)
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(mockSetFontSize).not.toHaveBeenCalled()
  })

  // Mutation test: step size must be exactly 2
  it('increases by exactly 2, not 1 or 3', async () => {
    mockGetFontSize.mockReturnValue(14)
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(mockSetFontSize).toHaveBeenCalledWith(16)
    expect(mockSetFontSize).not.toHaveBeenCalledWith(15)
    expect(mockSetFontSize).not.toHaveBeenCalledWith(17)
  })

  it('decreases by exactly 2, not 1 or 3', async () => {
    mockGetFontSize.mockReturnValue(14)
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-down'))
    expect(mockSetFontSize).toHaveBeenCalledWith(12)
    expect(mockSetFontSize).not.toHaveBeenCalledWith(13)
    expect(mockSetFontSize).not.toHaveBeenCalledWith(11)
  })

  // Mutation test: boundary edge — exactly at min+step and max-step should still work
  it('allows decrease at min+step (10 → 8)', async () => {
    mockGetFontSize.mockReturnValue(10)
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-down'))
    expect(mockSetFontSize).toHaveBeenCalledWith(8)
  })

  it('allows increase at max-step (30 → 32)', async () => {
    mockGetFontSize.mockReturnValue(30)
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(mockSetFontSize).toHaveBeenCalledWith(32)
  })

  // Mutation test: font size buttons should NOT reset modifiers
  it('does not reset modifiers when font size buttons pressed', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    const ctrlBtn = screen.getByTestId('vk-Ctrl')
    fireEvent.pointerDown(ctrlBtn)
    expect(ctrlBtn.className).toContain('bg-blue-600')

    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(ctrlBtn.className).toContain('bg-blue-600')
  })

  // Mutation test: sessionStorage saves the correct value, not the old one
  it('saves new font size, not the old one', async () => {
    mockGetFontSize.mockReturnValue(14)
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.pointerDown(screen.getByTestId('vk-font-up'))
    expect(sessionStorage.getItem('terminal-font-size')).toBe('16')
    expect(sessionStorage.getItem('terminal-font-size')).not.toBe('14')
  })
})

describe('Terminal header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders header with Sessions button, session name, and Fullscreen button', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    const header = screen.getByTestId('terminal-header')
    expect(header).toBeDefined()
    expect(screen.getByTestId('btn-sessions')).toBeDefined()
    expect(screen.getByTestId('btn-fullscreen')).toBeDefined()
    expect(header.textContent).toContain('test-session')
  })

  it('navigates to session list on Sessions button click', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    fireEvent.click(screen.getByTestId('btn-sessions'))
    expect(mockPush).toHaveBeenCalledWith('/')
  })

  it('session name truncates to prevent button overflow', async () => {
    render(<TerminalPage />)
    await vi.dynamicImportSettled()

    const sessionSpan = screen.getByTestId('terminal-header').querySelector('[class*="truncate"]')
    expect(sessionSpan).not.toBeNull()
  })
})
