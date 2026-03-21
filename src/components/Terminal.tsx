'use client'

import { useEffect, useRef } from 'react'
import { createTerminalConnection } from '@/lib/terminal-client'

export default function Terminal({ session }: { session: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const handle = createTerminalConnection(session, containerRef.current)
    return () => handle.cleanup()
  }, [session])

  return (
    <div
      ref={containerRef}
      className="h-screen w-screen bg-black"
    />
  )
}
