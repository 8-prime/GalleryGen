import { api } from './api'

export interface AdminUser {
  id: string
  email: string
  plan: string
  created_at: string
  is_admin: boolean
  can_create_portfolio: boolean
  can_publish_portfolio: boolean
}

export interface UpdatePermissionsParams {
  is_admin: boolean
  can_create_portfolio: boolean
  can_publish_portfolio: boolean
}

export function listUsers(): Promise<AdminUser[]> {
  return api.get('admin/users').json<AdminUser[]>()
}

export function updateUserPermissions(id: string, perms: UpdatePermissionsParams): Promise<void> {
  return api.patch(`admin/users/${id}`, { json: perms }).json()
}
