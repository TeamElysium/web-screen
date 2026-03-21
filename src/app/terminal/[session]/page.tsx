'use client'

import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export default function TerminalPage() {
  const params = useParams<{ session: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!containerRef.current || !params.session) return

    let cleanup: (() => void) | undefined

    import('@/lib/terminal-client').then(({ createTerminalConnection }) => {
      if (containerRef.current) {
        cleanup = createTerminalConnection(params.session, containerRef.current)
      }
    }).catch(() => {
      setError('Failed to load terminal')
    })

    return () => cleanup?.()
  }, [params.session])

  if (error) {
    return <div className="p-8 text-red-500">{error}</div>
  }

  return (
    <div
      ref={containerRef}
      className="h-screen w-screen bg-black"
    />
  )
}
