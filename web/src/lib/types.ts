export interface Portfolio {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  published: boolean;
  created_at: string;
}

export interface Image {
  folder_id: string | null;
  id: string;
  filename: string;
  mime_type: string;
  width: number;
  height: number;
  size_bytes: number;
  thumb_url: string;
  full_url: string;
  created_at: string;
}

export interface ImageListResult {
  images: Image[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImageFolder {
  id: string;
  name: string;
  image_count: number;
}
