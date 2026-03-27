import { api } from './api'

export interface Portfolio {
  id: string
  slug: string
  title: string
  description: string | null
  published: boolean
  gap_px: number
  matte_px: number
  created_at: string
}

export interface Page {
  id: string
  portfolio_id: string
  type: string
  slug: string
  title: string
  sort_order: number
}

export interface PortfolioImage {
  id: string
  image_id: string
  sort_order: number
  col_span: number
  row_span: number
  col_start: number
  row_start: number
  row_break_before: boolean
  filename: string
  mime_type: string
  width: number
  height: number
  thumb_url: string
  full_url: string
}

export interface PublicImage {
  id: string
  image_id: string
  sort_order: number
  col_span: number
  row_span: number
  col_start: number
  row_start: number
  filename: string
  width: number
  height: number
  url: string
}

export interface PublicPage {
  id: string
  title: string
  slug: string
  sort_order: number
  images: PublicImage[]
}

export interface PublicPortfolio {
  id: string
  title: string
  description: string | null
  pages: PublicPage[]
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createPortfolio(title: string, description?: string): Promise<Portfolio> {
  return api
    .post('portfolios', {
      json: { title, description: description || undefined },
    })
    .json<Portfolio>()
}

export function updatePortfolio(
  id: string,
  data: { title: string; description?: string; slug: string; published: boolean; gap_px: number; matte_px: number }
): Promise<Portfolio> {
  return api.put(`portfolios/${id}`, { json: data }).json<Portfolio>()
}

export function deletePortfolio(id: string): Promise<void> {
  return api.delete(`portfolios/${id}`).then(() => undefined)
}

// Main-page image endpoints (backward compat)
export function listPortfolioImages(portfolioId: string): Promise<PortfolioImage[]> {
  return api.get(`portfolios/${portfolioId}/images`).json<PortfolioImage[]>()
}

export function addImageToPortfolio(portfolioId: string, imageId: string): Promise<PortfolioImage> {
  return api
    .post(`portfolios/${portfolioId}/images`, { json: { image_id: imageId } })
    .json<PortfolioImage>()
}

export function removeImageFromPortfolio(portfolioId: string, itemId: string): Promise<void> {
  return api.delete(`portfolios/${portfolioId}/images/${itemId}`).then(() => undefined)
}

// Pages CRUD
export function listPages(portfolioId: string): Promise<Page[]> {
  return api.get(`portfolios/${portfolioId}/pages`).json<Page[]>()
}

export function createPage(
  portfolioId: string,
  data: { title: string; slug?: string; sort_order?: number }
): Promise<Page> {
  return api.post(`portfolios/${portfolioId}/pages`, { json: data }).json<Page>()
}

export function updatePage(
  portfolioId: string,
  pageId: string,
  data: { title: string; slug: string; sort_order: number }
): Promise<Page> {
  return api.put(`portfolios/${portfolioId}/pages/${pageId}`, { json: data }).json<Page>()
}

export function deletePage(portfolioId: string, pageId: string): Promise<void> {
  return api.delete(`portfolios/${portfolioId}/pages/${pageId}`).then(() => undefined)
}

// Page-specific image endpoints
export function listPageImages(portfolioId: string, pageId: string): Promise<PortfolioImage[]> {
  return api.get(`portfolios/${portfolioId}/pages/${pageId}/images`).json<PortfolioImage[]>()
}

export function addImageToPage(
  portfolioId: string,
  pageId: string,
  imageId: string
): Promise<PortfolioImage> {
  return api
    .post(`portfolios/${portfolioId}/pages/${pageId}/images`, { json: { image_id: imageId } })
    .json<PortfolioImage>()
}

export function removeImageFromPage(
  portfolioId: string,
  pageId: string,
  itemId: string
): Promise<void> {
  return api
    .delete(`portfolios/${portfolioId}/pages/${pageId}/images/${itemId}`)
    .then(() => undefined)
}

export function updateImageLayout(
  portfolioId: string,
  pageId: string,
  itemId: string,
  data: { col_span: number; row_span: number; row_break_before?: boolean }
): Promise<PortfolioImage> {
  return api
    .patch(`portfolios/${portfolioId}/pages/${pageId}/images/${itemId}`, { json: data })
    .json<PortfolioImage>()
}

export function reorderPageImages(portfolioId: string, pageId: string, ids: string[]): Promise<void> {
  return api
    .post(`portfolios/${portfolioId}/pages/${pageId}/images/reorder`, { json: { ids } })
    .then(() => undefined)
}

export function getPublicPortfolio(slug: string): Promise<PublicPortfolio> {
  return fetch(`/api/public/portfolios/${slug}`).then((r) => {
    if (!r.ok) throw new Error('not found')
    return r.json()
  })
}
