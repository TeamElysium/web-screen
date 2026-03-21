'use client'

import { useState, useEffect } from 'react'

export default function LoginPage() {
  const [error, setError] = useState('')

  useEffect(() => {
    if (window.location.search.includes('error=1')) {
      setError('Wrong password')
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form action="/api/auth" method="POST" className="flex flex-col gap-4 p-8">
        <h1 className="text-2xl font-bold">web-screen</h1>
        <input
          type="password"
          name="password"
          placeholder="Password"
          className="rounded border px-4 py-2"
          autoFocus
        />
        {error && <p className="text-red-500">{error}</p>}
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Login
        </button>
      </form>
    </div>
  )
}
