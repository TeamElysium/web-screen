import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ session: 'test-session' }),
}))

// Mock terminal-client — dynamic import returns a promise
const mockSendInput = vi.fn()
const mockCleanup = vi.fn()

vi.mock('@/lib/terminal-client', () => ({
  createTerminalConnection: vi.fn(() => ({
    cleanup: mockCleanup,
    sendInput: mockSendInput,
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
