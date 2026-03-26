import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Upload, ImageIcon } from 'lucide-react'
import { listImages, uploadImage, deleteImage } from '../lib/images'
import type { Image } from '../lib/types'

interface Props {
  onSelect?: (image: Image) => void
  selectable?: boolean
}

export function ImageExplorer({ onSelect, selectable = false }: Props) {
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  const limit = 50

  const { data, isLoading } = useQuery({
    queryKey: ['images', offset],
    queryFn: () => listImages(limit, offset),
  })

  const uploadMutation = useMutation({
    mutationFn: uploadImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] })
    },
  })

  const onDrop = useCallback(
    (files: File[]) => {
      files.forEach((file) => uploadMutation.mutate(file))
    },
    [uploadMutation],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'] },
  })

  const images = data?.images ?? []
  const total = data?.total ?? 0
  const hasMore = offset + limit < total

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
        {isDragActive ? (
          <p className="text-indigo-600 font-medium">Drop images here</p>
        ) : (
          <p className="text-gray-500 text-sm">
            Drag & drop images, or <span className="text-indigo-600">click to browse</span>
          </p>
        )}
        {uploadMutation.isPending && (
          <p className="text-sm text-indigo-600 mt-2">Uploading…</p>
        )}
      </div>

      {/* Upload errors */}
      {uploadMutation.isError && (
        <p className="text-sm text-red-600">Upload failed. Please try again.</p>
      )}

      {/* Image grid */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : images.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <ImageIcon className="mx-auto h-12 w-12 mb-3 opacity-40" />
          <p className="text-sm">No images yet. Upload some to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {images.map((img) => (
            <ImageTile
              key={img.id}
              image={img}
              selectable={selectable}
              onSelect={onSelect}
              onDelete={() => deleteMutation.mutate(img.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} image{total !== 1 ? 's' : ''}</span>
        <div className="flex gap-2">
          {offset > 0 && (
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
            >
              Previous
            </button>
          )}
          {hasMore && (
            <button
              onClick={() => setOffset(offset + limit)}
              className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface TileProps {
  image: Image
  selectable: boolean
  onSelect?: (image: Image) => void
  onDelete: () => void
}

function ImageTile({ image, selectable, onSelect, onDelete }: TileProps) {
  const [hovered, setHovered] = useState(false)

  // If imgproxy isn't configured, fall back to a placeholder
  const src = image.thumb_url || `https://placehold.co/400x400/e5e7eb/9ca3af?text=${encodeURIComponent(image.filename)}`

  return (
    <div
      className={`relative aspect-square rounded-lg overflow-hidden bg-gray-100 group ${
        selectable ? 'cursor-pointer' : ''
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => selectable && onSelect?.(image)}
    >
      <img
        src={src}
        alt={image.filename}
        className="w-full h-full object-cover"
        loading="lazy"
      />
      {hovered && (
        <div className="absolute inset-0 bg-black/40 flex items-start justify-end p-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1.5 bg-white/90 rounded-md hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Delete image"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
      {selectable && hovered && (
        <div className="absolute inset-0 ring-2 ring-indigo-500 pointer-events-none rounded-lg" />
      )}
    </div>
  )
}
