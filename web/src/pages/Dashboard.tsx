import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { clearTokens } from '../lib/auth'

interface Portfolio {
  id: string
  slug: string
  title: string
  description: string | null
  published: boolean
  created_at: string
}

export function Dashboard() {
  const navigate = useNavigate()

  const { data: portfolios = [], isLoading } = useQuery({
    queryKey: ['portfolios'],
    queryFn: () => api.get('portfolios').json<Portfolio[]>(),
  })

  function handleLogout() {
    clearTokens()
    navigate('/app/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">GalleryGen</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Sign out
        </button>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium text-gray-900">Portfolios</h2>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/app/images')}
              className="px-4 py-2 bg-white text-gray-700 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 font-medium"
            >
              Images
            </button>
            <button className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium">
              New portfolio
            </button>
          </div>
        </div>
        {isLoading ? (
          <p className="text-gray-500">Loading…</p>
        ) : portfolios.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg mb-2">No portfolios yet</p>
            <p className="text-sm">Create your first portfolio to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {portfolios.map((p) => (
              <div key={p.id} className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{p.title}</p>
                  <p className="text-sm text-gray-500">/{p.slug}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${p.published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {p.published ? 'Published' : 'Draft'}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
