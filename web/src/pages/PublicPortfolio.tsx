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
      <header className="px-6 py-5 flex items-center gap-8 border-b border-gray-100">
        <button
          onClick={() => setSelectedPageIdx(0)}
          className="text-xl font-light tracking-wide text-black shrink-0"
        >
          {portfolio.title}
        </button>
        {visiblePages.length > 1 && (
          <nav className="flex gap-6">
            {visiblePages.slice(1).map((page: PublicPage, idx: number) => (
              <button
                key={page.id}
                onClick={() => setSelectedPageIdx(idx + 1)}
                className={`text-sm transition-colors ${
                  idx + 1 === selectedPageIdx
                    ? 'text-black font-medium'
                    : 'text-gray-500 hover:text-black'
                }`}
              >
                {page.title}
              </button>
            ))}
          </nav>
        )}
      </header>
      {portfolio.description && (
        <p className="px-6 pt-3 pb-1 text-gray-500">{portfolio.description}</p>
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
