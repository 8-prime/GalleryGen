import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clearTokens } from '../lib/auth'
import { listUsers, updateUserPermissions, type AdminUser } from '../lib/admin'

export function AdminPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: listUsers,
  })

  function handleLogout() {
    clearTokens()
    navigate('/app/login')
  }

  async function handleToggle(user: AdminUser, field: 'is_admin' | 'can_create_portfolio' | 'can_publish_portfolio') {
    await updateUserPermissions(user.id, {
      is_admin: field === 'is_admin' ? !user.is_admin : user.is_admin,
      can_create_portfolio: field === 'can_create_portfolio' ? !user.can_create_portfolio : user.can_create_portfolio,
      can_publish_portfolio: field === 'can_publish_portfolio' ? !user.can_publish_portfolio : user.can_publish_portfolio,
    })
    queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">GalleryGen</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/app/dashboard')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Dashboard
          </button>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h2 className="text-lg font-medium text-gray-900 mb-6">Users</h2>
        {isLoading ? (
          <p className="text-gray-500">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-gray-500">No users found.</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Plan</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Joined</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">Can Create</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">Can Publish</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{user.email}</td>
                    <td className="px-4 py-3 text-gray-500">{user.plan || 'free'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={user.can_create_portfolio}
                        onChange={() => handleToggle(user, 'can_create_portfolio')}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={user.can_publish_portfolio}
                        onChange={() => handleToggle(user, 'can_publish_portfolio')}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={user.is_admin}
                        onChange={() => handleToggle(user, 'is_admin')}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 cursor-pointer"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
