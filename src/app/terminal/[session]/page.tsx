import dynamic from 'next/dynamic'

const Terminal = dynamic(() => import('@/components/Terminal'), { ssr: false })

export default async function TerminalPage({ params }: { params: Promise<{ session: string }> }) {
  const { session } = await params
  return <Terminal session={session} />
}
