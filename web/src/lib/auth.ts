import { api } from './api'

export interface CurrentUser {
  id: string
  email: string
  plan: string
  is_admin: boolean
  can_create_portfolio: boolean
  can_publish_portfolio: boolean
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('access_token')
}

export function setTokens(accessToken: string, refreshToken?: string) {
  localStorage.setItem('access_token', accessToken)
  if (refreshToken) {
    localStorage.setItem('refresh_token', refreshToken)
  }
}

export function clearTokens() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return api.get('auth/me').json<CurrentUser>()
}
