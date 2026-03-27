import { Navigate, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { isAuthenticated, getCurrentUser } from '../lib/auth'

export function AdminRoute() {
  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
    retry: false,
  })

  if (!isAuthenticated()) {
    return <Navigate to="/app/login" replace />
  }
  if (isLoading) {
    return null
  }
  if (!user?.is_admin) {
    return <Navigate to="/app/dashboard" replace />
  }
  return <Outlet />
}
