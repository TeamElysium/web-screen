'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface ScreenSession {
  id: string
  name: string
  status: 'attached' | 'detached'
}

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/

export default function Home() {
  const [sessions, setSessions] = useState<ScreenSession[]>([])
  const [showModal, setShowModal] = useState(false)
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
    if (!confirm(`"${name}" 세션을 삭제하시겠습니까?`)) return
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

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    if (!SAFE_NAME.test(name) || name.length > 100) {
      setError('영문, 숫자, 하이픈, 밑줄만 사용 가능 (최대 100자)')
      return
    }
    setError('')

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (res.ok) {
      setNewName('')
      setShowModal(false)
      router.push(`/terminal/${name}`)
    } else {
      const data = await res.json()
      setError(data.error || 'Failed to create session')
    }
  }

  return (
    <div className="mx-auto max-w-2xl overflow-hidden p-4 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">web-screen</h1>
        <button
          onClick={() => { setNewName(''); setError(''); setShowModal(true) }}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          + Session
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="mx-4 w-full max-w-sm rounded bg-background p-6 text-foreground" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">New Session</h2>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Session name"
              autoFocus
              className="mb-2 w-full rounded border px-4 py-2"
            />
            {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="rounded px-4 py-2 text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {!showModal && error && <p className="mb-4 text-red-500">{error}</p>}

      {sessions.length === 0 ? (
        <p className="text-gray-500">No screen sessions found.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="rounded border p-3">
              <div className="break-all font-medium">{s.name}</div>
              <div className="mt-1 flex items-center">
                <span
                  className={
                    s.status === 'attached'
                      ? 'text-sm text-green-600'
                      : 'text-sm text-gray-500'
                  }
                >
                  {s.status}
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => handleDelete(s.name)}
                    className="rounded bg-red-900 px-3 py-1 text-sm text-white hover:bg-red-800"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => router.push(`/terminal/${s.name}`)}
                    className="rounded bg-gray-800 px-3 py-1 text-sm text-white hover:bg-gray-700"
                  >
                    Connect
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
