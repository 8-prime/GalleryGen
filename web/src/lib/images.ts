import { api } from "./api";
import type { Image, ImageFolder, ImageListResult } from "./types";

export interface ImageFilters {
  search?: string;
  folder?: string;
  sort?: string;
}
export async function listImages(
  limit = 50,
  offset = 0,
  filters: ImageFilters = {},
): Promise<ImageListResult> {
  return api
    .get("images", { searchParams: { limit, offset, ...filters } })
    .json<ImageListResult>();
}
export async function uploadImage(file: File, folder?: string): Promise<Image> {
  const form = new FormData();
  form.append("file", file);
  return api
    .post("images", { body: form, searchParams: folder ? { folder } : {} })
    .json<Image>();
}
export async function deleteImage(id: string): Promise<void> {
  await api.delete(`images/${id}`);
}
export function listFolders(): Promise<ImageFolder[]> {
  return api.get("folders").json<ImageFolder[]>();
}
export function createFolder(name: string): Promise<ImageFolder> {
  return api.post("folders", { json: { name } }).json<ImageFolder>();
}
export async function renameFolder(id: string, name: string): Promise<void> {
  await api.put(`folders/${id}`, { json: { name } });
}
export async function deleteFolder(id: string): Promise<void> {
  await api.delete(`folders/${id}`);
}
export async function moveImages(
  ids: string[],
  folder_id: string | null,
): Promise<void> {
  await api.put("images/folder", { json: { ids, folder_id } });
}
