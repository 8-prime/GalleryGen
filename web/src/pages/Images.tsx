import { useNavigate } from 'react-router-dom'
import { clearTokens } from '../lib/auth'
import { ImageExplorer } from '../components/ImageExplorer'

export function Images() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/app/dashboard')}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            ← Dashboard
          </button>
          <h1 className="text-xl font-semibold text-gray-900">Images</h1>
        </div>
        <button
          onClick={() => { clearTokens(); navigate('/app/login') }}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Sign out
        </button>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <ImageExplorer />
      </main>
    </div>
  )
}
