import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../lib/api";
import {
  updatePortfolio,
  listPages,
  createPage,
  deletePage,
  listPageImages,
  addImageToPage,
  removeImageFromPage,
  updateImageLayout,
  reorderPageImages,
  slugify,
  type Portfolio,
  type Page,
  type PortfolioImage,
} from "../lib/portfolios";
import { listImages, uploadImage } from "../lib/images";
import type { Image } from "../lib/types";

// --- Sortable canvas item ---

interface SortableItemProps {
  item: PortfolioImage;
  localColSpan: number;
  localRowSpan: number;
  rowBreakBefore: boolean;
  matte: number;
  onRemove: () => void;
  onResizeStart: (e: React.MouseEvent, item: PortfolioImage) => void;
  onRowResizeStart: (e: React.MouseEvent, item: PortfolioImage) => void;
  onToggleRowBreak: () => void;
}

function SortableItem({
  item,
  localColSpan,
  localRowSpan,
  rowBreakBefore,
  matte,
  onRemove,
  onResizeStart,
  onRowResizeStart,
  onToggleRowBreak,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `span ${localColSpan}`,
    gridRow: `span ${localRowSpan}`,
    opacity: isDragging ? 0.4 : 1,
    position: "relative",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-lg overflow-hidden bg-white"
    >
      {/* Drag handle covers the image */}
      <div
        {...attributes}
        {...listeners}
        style={{
          aspectRatio: `${localColSpan} / ${localRowSpan}`,
          cursor: isDragging ? "grabbing" : "grab",
          padding: `${matte}px`,
        }}
        className="w-full"
      >
        <img
          src={item.full_url}
          alt={item.filename}
          className="w-full h-full"
          style={{ objectFit: "cover", display: "block" }}
          draggable={false}
        />
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity z-10"
        title="Remove"
      >
        ×
      </button>

      {/* Row break toggle */}
      <button
        onClick={onToggleRowBreak}
        className={`absolute top-1.5 left-1.5 text-white rounded px-1.5 py-0.5 text-xs transition-opacity z-10 ${
          rowBreakBefore
            ? "bg-indigo-600 opacity-100"
            : "bg-black/50 hover:bg-indigo-500 opacity-0 group-hover:opacity-100"
        }`}
        title={rowBreakBefore ? "Remove row break" : "Force new row"}
      >
        ↵
      </button>

      {/* Horizontal resize handle (col span) */}
      <div
        onMouseDown={(e) => onResizeStart(e, item)}
        className="absolute bottom-1.5 right-1.5 bg-black/50 hover:bg-indigo-600 text-white rounded px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-ew-resize select-none z-10"
        title="Drag left/right to resize width"
      >
        ⟺
      </div>

      {/* Vertical resize handle (row span) */}
      <div
        onMouseDown={(e) => onRowResizeStart(e, item)}
        className="absolute bottom-1.5 left-1/2 -translate-x-1/2 bg-black/50 hover:bg-indigo-600 text-white rounded px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-ns-resize select-none z-10"
        title="Drag up/down to resize height"
      >
        ↕
      </div>

      {/* Span indicator */}
      <div className="absolute bottom-1.5 left-1.5 bg-black/40 text-white text-xs rounded px-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {localColSpan}×{localRowSpan}
      </div>
    </div>
  );
}

// --- Main editor ---

export function PortfolioEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);

  // --- Portfolio metadata ---
  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => api.get("portfolios").json<Portfolio[]>(),
    select: (list) => list.find((p) => p.id === id),
  });

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [published, setPublished] = useState(false);
  const [gap, setGap] = useState(4);
  const [matte, setMatte] = useState(0);
  const [slugEdited, setSlugEdited] = useState(false);

  useEffect(() => {
    if (portfolio) {
      setTitle(portfolio.title);
      setSlug(portfolio.slug);
      setDescription(portfolio.description ?? "");
      setPublished(portfolio.published);
      setGap(portfolio.gap_px ?? 4);
      setMatte(portfolio.matte_px ?? 0);
      setSlugEdited(true);
    }
  }, [portfolio]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updatePortfolio(id!, {
        title,
        slug,
        description: description || undefined,
        published,
        gap_px: gap,
        matte_px: matte,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["portfolios"] }),
  });

  // --- Pages ---
  const { data: pages = [] } = useQuery({
    queryKey: ["pages", id],
    queryFn: () => listPages(id!),
    enabled: !!id,
  });

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  useEffect(() => {
    if (pages.length > 0 && !selectedPageId) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  const selectedPage = pages.find((p) => p.id === selectedPageId);

  const [newPageTitle, setNewPageTitle] = useState("");
  const [showNewPage, setShowNewPage] = useState(false);

  const createPageMutation = useMutation({
    mutationFn: () =>
      createPage(id!, { title: newPageTitle, sort_order: pages.length }),
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: ["pages", id] });
      setSelectedPageId(page.id);
      setNewPageTitle("");
      setShowNewPage(false);
    },
  });

  const deletePageMutation = useMutation({
    mutationFn: (pageId: string) => deletePage(id!, pageId),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["pages", id] });
      queryClient.removeQueries({ queryKey: ["page-images", id, deletedId] });
      if (selectedPageId === deletedId) {
        setSelectedPageId(pages.find((p) => p.id !== deletedId)?.id ?? null);
      }
    },
  });

  // --- Page images ---
  const { data: pageImages = [] } = useQuery({
    queryKey: ["page-images", id, selectedPageId],
    queryFn: () => listPageImages(id!, selectedPageId!),
    enabled: !!selectedPageId,
  });

  // Local ordering for optimistic DnD updates
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  useEffect(() => {
    setLocalOrder(pageImages.map((pi) => pi.id));
  }, [pageImages]);

  const orderedItems = localOrder
    .map((oid) => pageImages.find((pi) => pi.id === oid))
    .filter(Boolean) as PortfolioImage[];

  // Local span overrides for optimistic resize preview
  const [localColSpans, setLocalColSpans] = useState<Record<string, number>>(
    {},
  );
  const [localRowSpans, setLocalRowSpans] = useState<Record<string, number>>(
    {},
  );
  const [localRowBreaks, setLocalRowBreaks] = useState<Record<string, boolean>>(
    {},
  );
  const getColSpan = (item: PortfolioImage) =>
    localColSpans[item.id] ?? item.col_span;
  const getRowSpan = (item: PortfolioImage) =>
    localRowSpans[item.id] ?? item.row_span;
  const getRowBreak = (item: PortfolioImage) =>
    localRowBreaks[item.id] ?? item.row_break_before;

  // --- Library images ---
  const { data: allImagesData } = useQuery({
    queryKey: ["images", 0],
    queryFn: () => listImages(200, 0),
  });
  const allImages = allImagesData?.images ?? [];
  const addedImageIds = new Set(
    pageImages.map((pi: PortfolioImage) => pi.image_id),
  );

  // --- Mutations ---
  const addMutation = useMutation({
    mutationFn: (imageId: string) =>
      addImageToPage(id!, selectedPageId!, imageId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["page-images", id, selectedPageId],
      }),
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) =>
      removeImageFromPage(id!, selectedPageId!, itemId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["page-images", id, selectedPageId],
      }),
  });

  const layoutMutation = useMutation({
    mutationFn: ({
      itemId,
      col_span,
      row_span,
      row_break_before,
    }: {
      itemId: string;
      col_span: number;
      row_span: number;
      row_break_before?: boolean;
    }) =>
      updateImageLayout(id!, selectedPageId!, itemId, {
        col_span,
        row_span,
        row_break_before,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["page-images", id, selectedPageId],
      }),
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderPageImages(id!, selectedPageId!, ids),
  });

  // --- Library upload ---
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleLibraryUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await Promise.all(Array.from(files).map((f) => uploadImage(f)));
      queryClient.invalidateQueries({ queryKey: ["images", 0] });
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  // --- DnD (reorder within canvas) ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localOrder.indexOf(active.id as string);
    const newIndex = localOrder.indexOf(over.id as string);
    const newOrder = arrayMove(localOrder, oldIndex, newIndex);
    setLocalOrder(newOrder);
    reorderMutation.mutate(newOrder);
  }

  // --- Library drag → canvas (HTML5 DnD) ---
  const [isDragOver, setIsDragOver] = useState(false);

  function handleLibraryDragStart(e: React.DragEvent, imageId: string) {
    e.dataTransfer.setData("imageId", imageId);
    e.dataTransfer.effectAllowed = "copy";
  }

  function handleCanvasDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const imageId = e.dataTransfer.getData("imageId");
    if (imageId && selectedPageId && !addedImageIds.has(imageId)) {
      addMutation.mutate(imageId);
    }
  }

  // --- Resize drag ---
  function handleResizeStart(e: React.MouseEvent, item: PortfolioImage) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startColSpan = getColSpan(item);
    const capturedRowSpan = getRowSpan(item);
    let currentColSpan = startColSpan;

    function onMouseMove(ev: MouseEvent) {
      if (!canvasRef.current) return;
      const canvasWidth = canvasRef.current.offsetWidth;
      const colWidth = canvasWidth / 3;
      const delta = ev.clientX - startX;
      const newSpan = Math.max(
        1,
        Math.min(3, startColSpan + Math.round(delta / colWidth)),
      );
      currentColSpan = newSpan;
      setLocalColSpans((prev) => ({ ...prev, [item.id]: newSpan }));
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (currentColSpan !== startColSpan) {
        layoutMutation.mutate({
          itemId: item.id,
          col_span: currentColSpan,
          row_span: capturedRowSpan,
          row_break_before: getRowBreak(item),
        });
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function handleRowResizeStart(e: React.MouseEvent, item: PortfolioImage) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startRowSpan = getRowSpan(item);
    const capturedColSpan = getColSpan(item);
    let currentRowSpan = startRowSpan;

    function onMouseMove(ev: MouseEvent) {
      if (!canvasRef.current) return;
      const rowUnit = canvasRef.current.offsetWidth / 3;
      const delta = ev.clientY - startY;
      const newSpan = Math.max(
        1,
        Math.min(3, startRowSpan + Math.round(delta / rowUnit)),
      );
      currentRowSpan = newSpan;
      setLocalRowSpans((prev) => ({ ...prev, [item.id]: newSpan }));
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (currentRowSpan !== startRowSpan) {
        layoutMutation.mutate({
          itemId: item.id,
          col_span: capturedColSpan,
          row_span: currentRowSpan,
          row_break_before: getRowBreak(item),
        });
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  const handleToggleRowBreak = useCallback(
    (item: PortfolioImage) => {
      const newVal = !getRowBreak(item);
      setLocalRowBreaks((prev) => ({ ...prev, [item.id]: newVal }));
      layoutMutation.mutate({
        itemId: item.id,
        col_span: getColSpan(item),
        row_span: getRowSpan(item),
        row_break_before: newVal,
      });
    },
    [pageImages, localColSpans, localRowSpans, localRowBreaks],
  ); // eslint-disable-line

  function handleTitleChange(val: string) {
    setTitle(val);
    if (!slugEdited) setSlug(slugify(val));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  if (loadingPortfolio) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Portfolio not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate("/app/dashboard")}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Portfolios
        </button>
        <span className="text-sm font-medium text-gray-700 truncate mx-4">
          {title}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          {portfolio.published && (
            <a
              href={`/p/${portfolio.slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-indigo-600 hover:underline"
            >
              View ↗
            </a>
          )}
          {saveMutation.isSuccess && (
            <span className="text-sm text-green-600">Saved</span>
          )}
          <button
            form="editor-form"
            type="submit"
            disabled={saveMutation.isPending}
            className="px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {/* Body: 3-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel: settings + pages */}
        <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
          {/* Settings */}
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Settings
            </h2>
            <form id="editor-form" onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Slug
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugEdited(true);
                  }}
                  required
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Description{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Gap <span className="text-gray-400 font-normal">{gap}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={32}
                  value={gap}
                  onChange={(e) => setGap(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Matte{" "}
                  <span className="text-gray-400 font-normal">{matte}px</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={64}
                  value={matte}
                  onChange={(e) => setMatte(Number(e.target.value))}
                  className="w-full accent-indigo-600"
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
                <label htmlFor="published" className="text-sm text-gray-700">
                  Published
                </label>
              </div>
            </form>
          </div>

          {/* Pages */}
          <div className="p-4 flex-1">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Pages
            </h2>
            <ul className="space-y-0.5 mb-3">
              {pages.map((page: Page) => (
                <li key={page.id} className="flex items-center gap-1">
                  <button
                    onClick={() => setSelectedPageId(page.id)}
                    className={`flex-1 text-left text-sm px-2 py-1.5 rounded-md truncate ${
                      selectedPageId === page.id
                        ? "bg-indigo-50 text-indigo-700 font-medium"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {page.title}
                    {page.type === "main" && (
                      <span className="ml-1 text-xs text-gray-400">(main)</span>
                    )}
                  </button>
                  {page.type !== "main" && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete page "${page.title}"?`)) {
                          deletePageMutation.mutate(page.id);
                        }
                      }}
                      className="text-gray-400 hover:text-red-500 text-xs px-1 shrink-0"
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
                    if (e.key === "Enter" && newPageTitle.trim())
                      createPageMutation.mutate();
                    if (e.key === "Escape") setShowNewPage(false);
                  }}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() => createPageMutation.mutate()}
                    disabled={
                      !newPageTitle.trim() || createPageMutation.isPending
                    }
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
                className="text-sm text-indigo-600 hover:text-indigo-800"
              >
                + Add page
              </button>
            )}
          </div>
        </aside>

        {/* Center: canvas */}
        <main className="flex-1 min-w-0 overflow-y-auto p-6">
          {!selectedPageId ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Select a page to edit.
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">
                  {selectedPage?.title}
                  <span className="ml-2 text-gray-400 font-normal">
                    ({pageImages.length}{" "}
                    {pageImages.length === 1 ? "image" : "images"})
                  </span>
                </h2>
                <p className="text-xs text-gray-400">
                  Drag images from the library → drop here to add. Drag to
                  reorder. ⟺ width, ↕ height.
                </p>
              </div>

              {/* Drop zone wrapper */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleCanvasDrop}
                className={`min-h-40 rounded-xl border-2 transition-colors ${
                  isDragOver
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-dashed border-gray-300 bg-white"
                }`}
              >
                {orderedItems.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                    {addMutation.isPending
                      ? "Adding…"
                      : "Drop images here or click + in the library"}
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={localOrder}
                      strategy={rectSortingStrategy}
                    >
                      <div
                        ref={canvasRef}
                        className="p-4 grid"
                        style={{
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gridAutoFlow: "row",
                          gap: `${gap}px`,
                        }}
                      >
                        {orderedItems.flatMap((item) => [
                          getRowBreak(item) ? (
                            <div
                              key={`break-${item.id}`}
                              style={{
                                gridColumn: "1 / -1",
                                height: 0,
                                margin: 0,
                              }}
                            />
                          ) : null,
                          <SortableItem
                            key={item.id}
                            item={item}
                            localColSpan={getColSpan(item)}
                            localRowSpan={getRowSpan(item)}
                            rowBreakBefore={getRowBreak(item)}
                            matte={matte}
                            onRemove={() => removeMutation.mutate(item.id)}
                            onResizeStart={handleResizeStart}
                            onRowResizeStart={handleRowResizeStart}
                            onToggleRowBreak={() => handleToggleRowBreak(item)}
                          />,
                        ])}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Right panel: image library */}
        <aside className="w-52 shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100 shrink-0 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Library
            </h2>
            <button
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 hrink-0"
              title="Upload images"
            >
              {uploading ? "…" : "+ Upload"}
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => handleLibraryUpload(e.target.files)}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {allImages.length === 0 ? (
              <p className="text-xs text-gray-400 p-2">
                No images yet. Click + Upload above.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {allImages.map((img: Image) => {
                  const inPage = addedImageIds.has(img.id);
                  const aspectRatio =
                    img.width && img.height
                      ? `${img.width} / ${img.height}`
                      : "1 / 1";
                  return (
                    <div
                      key={img.id}
                      draggable={!inPage}
                      onDragStart={
                        inPage
                          ? undefined
                          : (e) => handleLibraryDragStart(e, img.id)
                      }
                      className={`relative group rounded overflow-hidden bg-gray-100 cursor-pointer ${
                        inPage
                          ? "opacity-30 cursor-default"
                          : "hover:ring-2 hover:ring-indigo-400"
                      }`}
                      onClick={() => {
                        if (!inPage && selectedPageId)
                          addMutation.mutate(img.id);
                      }}
                      title={inPage ? img.filename : `Add ${img.filename}`}
                    >
                      <div style={{ aspectRatio }}>
                        <img
                          src={img.thumb_url}
                          alt={img.filename}
                          className="w-full h-full"
                          style={{ objectFit: "cover", display: "block" }}
                          draggable={false}
                        />
                      </div>
                      {!inPage && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                          <span className="text-white text-xl font-bold opacity-0 group-hover:opacity-100 transition-opacity drop-shadow">
                            +
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
