import { api } from './api'
import type { Image, ImageListResult } from './types'

export async function listImages(limit = 50, offset = 0): Promise<ImageListResult> {
  return api.get(`images?limit=${limit}&offset=${offset}`).json<ImageListResult>()
}

export async function uploadImage(file: File): Promise<Image> {
  const form = new FormData()
  form.append('file', file)
  return api.post('images', { body: form }).json<Image>()
}

export async function deleteImage(id: string): Promise<void> {
  await api.delete(`images/${id}`)
}
