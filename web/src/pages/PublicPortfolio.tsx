import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPublicPortfolio, type PublicPage, type PublicImage } from '../lib/portfolios'

export function PublicPortfolio() {
  const { slug } = useParams<{ slug: string }>()
  const [selectedPageIdx, setSelectedPageIdx] = useState(0)

  const { data: portfolio, isLoading, isError } = useQuery({
    queryKey: ['public-portfolio', slug],
    queryFn: () => getPublicPortfolio(slug!),
    enabled: !!slug,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    )
  }

  if (isError || !portfolio) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-500">Portfolio not found.</p>
      </div>
    )
  }

  const visiblePages = portfolio.pages.filter((p: PublicPage) => p.images.length > 0)
  const currentPage: PublicPage | undefined = visiblePages[selectedPageIdx]

  return (
    <div className="min-h-screen bg-white">
      <header className="px-6 py-10 text-center">
        <h1 className="text-3xl font-light tracking-wide text-gray-900">{portfolio.title}</h1>
        {portfolio.description && (
          <p className="mt-3 text-gray-500 max-w-xl mx-auto">{portfolio.description}</p>
        )}
      </header>

      {/* Page tabs (only shown if multiple pages have images) */}
      {visiblePages.length > 1 && (
        <nav className="flex justify-center gap-6 border-b border-gray-100 pb-0 mb-8 px-6">
          {visiblePages.map((page: PublicPage, idx: number) => (
            <button
              key={page.id}
              onClick={() => setSelectedPageIdx(idx)}
              className={`pb-3 text-sm border-b-2 transition-colors ${
                idx === selectedPageIdx
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {page.title}
            </button>
          ))}
        </nav>
      )}

      {/* Image grid */}
      {currentPage && currentPage.images.length > 0 ? (
        <div
          className="px-6 pb-12 mx-auto max-w-6xl"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
            gridAutoRows: '200px',
          }}
        >
          {currentPage.images.map((img: PublicImage) => (
            <div
              key={img.id}
              style={{
                gridColumn: `span ${img.col_span}`,
                gridRow: `span ${img.row_span}`,
              }}
            >
              <img
                src={img.url}
                alt={img.filename}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex justify-center py-20">
          <p className="text-gray-400">No images in this portfolio.</p>
        </div>
      )}
    </div>
  )
}
