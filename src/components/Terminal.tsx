'use client'

import { useEffect, useRef } from 'react'
import { createTerminalConnection } from '@/lib/terminal-client'

export default function Terminal({ session }: { session: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const cleanup = createTerminalConnection(session, containerRef.current)
    return cleanup
  }, [session])

  return (
    <div
      ref={containerRef}
      className="h-screen w-screen bg-black"
    />
  )
}
