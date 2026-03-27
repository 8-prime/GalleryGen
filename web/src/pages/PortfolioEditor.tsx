import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import {
  updatePortfolio,
  listPages,
  createPage,
  deletePage,
  listPageImages,
  addImageToPage,
  removeImageFromPage,
  updateImageLayout,
  slugify,
  type Portfolio,
  type Page,
  type PortfolioImage,
} from '../lib/portfolios'
import { listImages } from '../lib/images'
import type { Image } from '../lib/types'

const SIZE_OPTIONS = [
  { label: '1×1', col_span: 1, row_span: 1 },
  { label: '2×1', col_span: 2, row_span: 1 },
  { label: '1×2', col_span: 1, row_span: 2 },
  { label: '2×2', col_span: 2, row_span: 2 },
]

export function PortfolioEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({
    queryKey: ['portfolios'],
    queryFn: () => api.get('portfolios').json<Portfolio[]>(),
    select: (list) => list.find((p) => p.id === id),
  })

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [published, setPublished] = useState(false)
  const [slugEdited, setSlugEdited] = useState(false)

  useEffect(() => {
    if (portfolio) {
      setTitle(portfolio.title)
      setSlug(portfolio.slug)
      setDescription(portfolio.description ?? '')
      setPublished(portfolio.published)
      setSlugEdited(true)
    }
  }, [portfolio])

  const saveMutation = useMutation({
    mutationFn: () =>
      updatePortfolio(id!, { title, slug, description: description || undefined, published }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })

  // Pages
  const { data: pages = [] } = useQuery({
    queryKey: ['pages', id],
    queryFn: () => listPages(id!),
    enabled: !!id,
  })

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)

  // Auto-select first page
  useEffect(() => {
    if (pages.length > 0 && !selectedPageId) {
      setSelectedPageId(pages[0].id)
    }
  }, [pages, selectedPageId])

  const selectedPage = pages.find((p) => p.id === selectedPageId)

  const [newPageTitle, setNewPageTitle] = useState('')
  const [showNewPage, setShowNewPage] = useState(false)

  const createPageMutation = useMutation({
    mutationFn: () => createPage(id!, { title: newPageTitle, sort_order: pages.length }),
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: ['pages', id] })
      setSelectedPageId(page.id)
      setNewPageTitle('')
      setShowNewPage(false)
    },
  })

  const deletePageMutation = useMutation({
    mutationFn: (pageId: string) => deletePage(id!, pageId),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['pages', id] })
      queryClient.removeQueries({ queryKey: ['page-images', id, deletedId] })
      if (selectedPageId === deletedId) {
        setSelectedPageId(pages.find((p) => p.id !== deletedId)?.id ?? null)
      }
    },
  })

  // Images for selected page
  const { data: pageImages = [] } = useQuery({
    queryKey: ['page-images', id, selectedPageId],
    queryFn: () => listPageImages(id!, selectedPageId!),
    enabled: !!selectedPageId,
  })

  const { data: allImagesData } = useQuery({
    queryKey: ['images', 0],
    queryFn: () => listImages(200, 0),
  })
  const allImages = allImagesData?.images ?? []

  const addMutation = useMutation({
    mutationFn: (imageId: string) => addImageToPage(id!, selectedPageId!, imageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['page-images', id, selectedPageId] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => removeImageFromPage(id!, selectedPageId!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['page-images', id, selectedPageId] })
    },
  })

  const layoutMutation = useMutation({
    mutationFn: ({ itemId, col_span, row_span }: { itemId: string; col_span: number; row_span: number }) =>
      updateImageLayout(id!, selectedPageId!, itemId, { col_span, row_span }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['page-images', id, selectedPageId] })
    },
  })

  const addedImageIds = new Set(pageImages.map((pi: PortfolioImage) => pi.image_id))

  function handleTitleChange(val: string) {
    setTitle(val)
    if (!slugEdited) setSlug(slugify(val))
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    saveMutation.mutate()
  }

  if (loadingPortfolio) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    )
  }

  if (!portfolio) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Portfolio not found.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/app/dashboard')}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Portfolios
        </button>
        <div className="flex items-center gap-3">
          {portfolio.published && (
            <a
              href={`/p/${portfolio.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-indigo-600 hover:underline"
            >
              View published ↗
            </a>
          )}
          {saveMutation.isSuccess && (
            <span className="text-sm text-green-600">Saved</span>
          )}
          <button
            form="editor-form"
            type="submit"
            disabled={saveMutation.isPending}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left panel: settings + pages */}
          <div className="lg:col-span-1 space-y-4">
            {/* Settings */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Settings</h2>
              <form id="editor-form" onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => { setSlug(e.target.value); setSlugEdited(true) }}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="published"
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="published" className="text-sm text-gray-700">Published</label>
                </div>
              </form>
            </div>

            {/* Pages */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Pages</h2>
              <ul className="space-y-1 mb-3">
                {pages.map((page: Page) => (
                  <li key={page.id} className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedPageId(page.id)}
                      className={`flex-1 text-left text-sm px-2 py-1.5 rounded-md truncate ${
                        selectedPageId === page.id
                          ? 'bg-indigo-50 text-indigo-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {page.title}
                      {page.type === 'main' && (
                        <span className="ml-1 text-xs text-gray-400">(main)</span>
                      )}
                    </button>
                    {page.type !== 'main' && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete page "${page.title}"?`)) {
                            deletePageMutation.mutate(page.id)
                          }
                        }}
                        className="text-gray-400 hover:text-red-500 text-xs px-1"
                        title="Delete page"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {showNewPage ? (
                <div className="space-y-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Page title"
                    value={newPageTitle}
                    onChange={(e) => setNewPageTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newPageTitle.trim()) createPageMutation.mutate()
                      if (e.key === 'Escape') setShowNewPage(false)
                    }}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => createPageMutation.mutate()}
                      disabled={!newPageTitle.trim() || createPageMutation.isPending}
                      className="flex-1 text-sm px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setShowNewPage(false)}
                      className="flex-1 text-sm px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewPage(true)}
                  className="w-full text-sm text-indigo-600 hover:text-indigo-800 text-left"
                >
                  + Add page
                </button>
              )}
            </div>
          </div>

          {/* Right panel: page images + add images */}
          <div className="lg:col-span-3 space-y-6">
            {/* Images in selected page */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">
                {selectedPage ? `"${selectedPage.title}" — images` : 'Images'}
                <span className="ml-2 text-gray-400 font-normal">({pageImages.length})</span>
              </h2>
              {!selectedPageId ? (
                <p className="text-sm text-gray-400">Select a page to manage its images.</p>
              ) : pageImages.length === 0 ? (
                <p className="text-sm text-gray-400">No images yet. Add some below.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {pageImages.map((pi: PortfolioImage) => {
                    const currentSize = SIZE_OPTIONS.find(
                      (s) => s.col_span === pi.col_span && s.row_span === pi.row_span
                    )
                    return (
                      <div key={pi.id} className="relative group">
                        <div className="aspect-square">
                          <img
                            src={pi.thumb_url}
                            alt={pi.filename}
                            className="w-full h-full object-cover rounded-lg"
                          />
                        </div>
                        {/* Layout selector */}
                        <div className="mt-1 flex gap-1 flex-wrap">
                          {SIZE_OPTIONS.map((opt) => (
                            <button
                              key={opt.label}
                              onClick={() =>
                                layoutMutation.mutate({
                                  itemId: pi.id,
                                  col_span: opt.col_span,
                                  row_span: opt.row_span,
                                })
                              }
                              className={`text-xs px-1.5 py-0.5 rounded border ${
                                currentSize?.label === opt.label
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'border-gray-300 text-gray-600 hover:border-indigo-400'
                              }`}
                              title={`Set size to ${opt.label}`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => removeMutation.mutate(pi.id)}
                          disabled={removeMutation.isPending}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                          title="Remove from page"
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Add images */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Add images</h2>
              {!selectedPageId ? (
                <p className="text-sm text-gray-400">Select a page first.</p>
              ) : allImages.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No images in your library.{' '}
                  <button
                    onClick={() => navigate('/app/images')}
                    className="text-indigo-600 hover:underline"
                  >
                    Upload some
                  </button>
                  .
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                  {allImages.map((img: Image) => {
                    const inPage = addedImageIds.has(img.id)
                    return (
                      <div key={img.id} className="relative group aspect-square">
                        <img
                          src={img.thumb_url}
                          alt={img.filename}
                          className={`w-full h-full object-cover rounded-lg ${inPage ? 'opacity-30' : ''}`}
                        />
                        {!inPage && (
                          <button
                            onClick={() => addMutation.mutate(img.id)}
                            disabled={addMutation.isPending}
                            className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-600"
                            title="Add to page"
                          >
                            +
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
