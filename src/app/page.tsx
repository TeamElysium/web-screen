'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface ScreenSession {
  id: string
  name: string
  status: 'attached' | 'detached'
}

export default function Home() {
  const [sessions, setSessions] = useState<ScreenSession[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/sessions')
    if (res.ok) {
      setSessions(await res.json())
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  async function handleDelete(name: string) {
    setError('')
    const res = await fetch('/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      fetchSessions()
    } else {
      const data = await res.json()
      setError(data.error || 'Failed to delete session')
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!newName.trim()) return

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })

    if (res.ok) {
      setNewName('')
      fetchSessions()
    } else {
      const data = await res.json()
      setError(data.error || 'Failed to create session')
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-8 text-2xl font-bold">web-screen</h1>

      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Session name"
          className="flex-1 rounded border px-4 py-2"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          New Session
        </button>
      </form>

      {error && <p className="mb-4 text-red-500">{error}</p>}

      {sessions.length === 0 ? (
        <p className="text-gray-500">No screen sessions found.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left">Name</th>
              <th className="py-2 text-left">Status</th>
              <th className="py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b">
                <td className="py-2">{s.name}</td>
                <td className="py-2">
                  <span
                    className={
                      s.status === 'attached'
                        ? 'text-green-600'
                        : 'text-gray-500'
                    }
                  >
                    {s.status}
                  </span>
                </td>
                <td className="py-2 flex gap-2">
                  <button
                    onClick={() => router.push(`/terminal/${s.name}`)}
                    className="rounded bg-gray-800 px-3 py-1 text-sm text-white hover:bg-gray-700"
                  >
                    Connect
                  </button>
                  <button
                    onClick={() => handleDelete(s.name)}
                    className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
