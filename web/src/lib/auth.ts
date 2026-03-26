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
