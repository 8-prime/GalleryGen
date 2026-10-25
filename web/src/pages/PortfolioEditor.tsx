import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Undo2,
  Redo2,
  Plus,
  Images,
  Smartphone,
  Monitor,
  Trash2,
  ExternalLink,
  Save,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import {
  addImageToPage,
  createPage,
  deletePage,
  listPages,
  listPageImages,
  removeImageFromPage,
  saveCanvas,
  slugify,
  updatePortfolio,
  type Page,
  type Portfolio,
  type PortfolioImage,
} from "../lib/portfolios";
import {
  bounds,
  clampFrame,
  MAX_HEIGHT,
  PAGE_WIDTH,
  snapAxis,
  toCanvas,
  type CanvasImage,
} from "../lib/canvas";
import { LibraryDialog } from "../components/ImageExplorer";
import type { Image } from "../lib/types";
import "../styles/studio.css";

interface WorkspaceHandle {
  save: () => Promise<void>;
  dirty: () => boolean;
}
export function PortfolioEditor() {
  const { id } = useParams<{ id: string }>();
  const portfolio = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => api.get("portfolios").json<Portfolio[]>(),
    select: (rows) => rows.find((row) => row.id === id),
  });
  const pages = useQuery({
    queryKey: ["pages", id],
    queryFn: () => listPages(id!),
    enabled: !!id,
  });
  if (portfolio.isLoading || pages.isLoading)
    return <div className="studio-loading">Opening your portfolio…</div>;
  if (!portfolio.data || !pages.data)
    return (
      <div className="studio-loading">
        The portfolio could not be loaded.{" "}
        <a href="/app/dashboard">Return to portfolios</a>
      </div>
    );
  return (
    <PortfolioStudio key={id} portfolio={portfolio.data} pages={pages.data} />
  );
}

function PortfolioStudio({
  portfolio,
  pages,
}: {
  portfolio: Portfolio;
  pages: Page[];
}) {
  const navigate = useNavigate(),
    query = useQueryClient();
  const [meta, setMeta] = useState({ ...portfolio });
  const [pageId, setPageId] = useState(pages[0]?.id ?? "");
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const workspace = useRef<WorkspaceHandle>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (settings) settingsRef.current?.showModal();
  }, [settings]);
  const current = pages.find((page) => page.id === pageId);
  const metadataDirty = JSON.stringify(meta) !== JSON.stringify(portfolio);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (metadataDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [metadataDirty]);
  function mayLeave() {
    return (
      !(workspace.current?.dirty() || metadataDirty) ||
      confirm("Discard unsaved changes?")
    );
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await workspace.current?.save();
      await updatePortfolio(portfolio.id, {
        title: meta.title,
        slug: meta.slug,
        description: meta.description ?? undefined,
        published: meta.published,
        gap_px: meta.gap_px,
        matte_px: meta.matte_px,
      });
      await query.invalidateQueries({ queryKey: ["portfolios"] });
      setMessage("All changes saved");
    } catch {
      setMessage(
        "Could not save all changes. Your edits are still here; please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addPage() {
    if (workspace.current?.dirty()) {
      setMessage("Save the current page before adding another.");
      return;
    }
    const title = prompt("Name your page");
    if (!title?.trim()) return;
    setBusy(true);
    try {
      const page = await createPage(portfolio.id, {
        title: title.trim(),
        sort_order: pages.length,
      });
      await query.invalidateQueries({ queryKey: ["pages", portfolio.id] });
      setPageId(page.id);
    } catch {
      setMessage("Could not create the page.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="studio">
      <header className="studio-header">
        <div className="inline-actions">
          <button
            className="icon-button"
            aria-label="Back to portfolios"
            onClick={() => {
              if (mayLeave()) navigate("/app/dashboard");
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <span className="studio-wordmark">
            photo mat<span>.</span>
          </span>
          <span className="header-divider" />
          <strong>{meta.title}</strong>
          <span className="status-pill">
            {meta.published ? "Published" : "Draft"}
          </span>
        </div>
        <div className="inline-actions">
          <button
            className="studio-button"
            onClick={() => setSettings(!settings)}
          >
            Portfolio settings
          </button>
          {portfolio.published && (
            <a
              className="studio-button"
              href={`/p/${portfolio.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              View <ExternalLink size={14} />
            </a>
          )}
          <button
            className="studio-button primary"
            disabled={busy}
            onClick={() => void save()}
          >
            <Save size={15} />
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </header>
      {message && (
        <div
          role="status"
          className={`studio-notice ${message.startsWith("Could") ? "error" : ""}`}
        >
          {message}
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setMessage("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="studio-body">
        <aside className="page-panel">
          <span className="panel-label">Portfolio pages</span>
          <div className="page-list">
            {pages.map((page, index) => (
              <button
                key={page.id}
                disabled={busy}
                className={page.id === pageId ? "active" : ""}
                onClick={() => {
                  if (
                    page.id !== pageId &&
                    (!workspace.current?.dirty() ||
                      confirm("Discard unsaved layout changes on this page?"))
                  )
                    setPageId(page.id);
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {page.title}
              </button>
            ))}
          </div>
          <button
            className="studio-button"
            disabled={busy}
            onClick={() => void addPage()}
          >
            <Plus size={14} />
            Add page
          </button>
          <a
            className="library-shortcut"
            href="/app/images"
            target="_blank"
            rel="noreferrer"
          >
            <Images size={16} />
            Open full library <ExternalLink size={12} />
          </a>
          <p className="studio-hint">
            Arrange freely.
            <br />
            Other images stay put.
            <br />
            <br />
            Shift-click to select several. Hold Alt to bypass snapping.
          </p>
          {current && current.type !== "main" && (
            <button
              className="delete-page"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    `Delete “${current.title}” and its placements? Original photographs will remain in your library.`,
                  )
                )
                  return;
                setBusy(true);
                try {
                  await deletePage(portfolio.id, current.id);
                  setPageId(pages.find((p) => p.id !== current.id)?.id ?? "");
                  await query.invalidateQueries({
                    queryKey: ["pages", portfolio.id],
                  });
                } catch {
                  setMessage("Could not delete the page.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete this page
            </button>
          )}
        </aside>
        {pageId ? (
          <PageWorkspace
            key={pageId}
            portfolio={portfolio.id}
            pageId={pageId}
            title={current?.title ?? "Page"}
            gap={meta.gap_px}
            matte={meta.matte_px}
            ref={workspace}
          />
        ) : (
          <div className="studio-empty">
            <h2>Your first page starts here.</h2>
            <button
              className="studio-button primary"
              onClick={() => void addPage()}
            >
              Create a page
            </button>
          </div>
        )}
      </div>
      {settings && (
        <dialog
          ref={settingsRef}
          className="settings-shade"
          onCancel={() => setSettings(false)}
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Portfolio settings"
          >
            <div className="panel-heading">
              <h2>Portfolio settings</h2>
              <button
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setSettings(false)}
              >
                <X />
              </button>
            </div>
            <label>
              Title
              <input
                value={meta.title}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              />
            </label>
            <label>
              Public address
              <input
                value={meta.slug}
                onChange={(e) =>
                  setMeta({ ...meta, slug: slugify(e.target.value) })
                }
              />
            </label>
            <label>
              Description
              <textarea
                value={meta.description ?? ""}
                onChange={(e) =>
                  setMeta({ ...meta, description: e.target.value })
                }
              />
            </label>
            <label>
              Gap for mobile and initial layouts · {meta.gap_px}px
              <input
                type="range"
                min={0}
                max={40}
                value={meta.gap_px}
                onChange={(e) => setMeta({ ...meta, gap_px: +e.target.value })}
              />
            </label>
            <label>
              Matte · {meta.matte_px}px
              <input
                type="range"
                min={0}
                max={64}
                value={meta.matte_px}
                onChange={(e) =>
                  setMeta({ ...meta, matte_px: +e.target.value })
                }
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={meta.published}
                onChange={(e) =>
                  setMeta({ ...meta, published: e.target.checked })
                }
              />
              Published
            </label>
            <p className="studio-hint">
              Use Save changes to save these settings and the current page
              layout.
            </p>
            <button
              className="studio-button primary"
              onClick={() => setSettings(false)}
            >
              Done
            </button>
          </section>
        </dialog>
      )}
    </div>
  );
}

function PageWorkspace({
  portfolio,
  pageId,
  title,
  gap,
  matte,
  ref,
}: {
  portfolio: string;
  pageId: string;
  title: string;
  gap: number;
  matte: number;
  ref: Ref<WorkspaceHandle>;
}) {
  const images = useQuery({
    queryKey: ["page-images", portfolio, pageId],
    queryFn: () => listPageImages(portfolio, pageId),
    refetchOnWindowFocus: false,
  });
  if (images.isLoading)
    return <div className="studio-loading">Loading page…</div>;
  if (!images.data)
    return (
      <div className="studio-loading">
        Could not load the page.{" "}
        <button onClick={() => void images.refetch()}>Try again</button>
      </div>
    );
  return (
    <CanvasWorkspace
      portfolio={portfolio}
      pageId={pageId}
      title={title}
      initial={images.data}
      gap={gap}
      matte={matte}
      ref={ref}
    />
  );
}

interface Gesture {
  pointer: number;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  before: CanvasImage[];
  ids: string[];
  clientX: number;
  clientY: number;
  alt: boolean;
  shift: boolean;
}
function CanvasWorkspace({
  portfolio,
  pageId,
  title,
  initial,
  gap,
  matte,
  ref,
}: {
  portfolio: string;
  pageId: string;
  title: string;
  initial: PortfolioImage[];
  gap: number;
  matte: number;
  ref: Ref<WorkspaceHandle>;
}) {
  const query = useQueryClient();
  const [items, setItems] = useState(() => toCanvas(initial, gap));
  const [selected, setSelected] = useState<string[]>([]);
  const [undo, setUndo] = useState<CanvasImage[][]>([]),
    [redo, setRedo] = useState<CanvasImage[][]>([]);
  const [dirty, setDirty] = useState(initial.some(image => image.canvas_x === null)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [picker, setPicker] = useState<"add" | "replace" | null>(null);
  const [snap, setSnap] = useState(true),
    [grid, setGrid] = useState(12),
    [zoom, setZoom] = useState("fit");
  const [mobile, setMobile] = useState(false),
    [inspector, setInspector] = useState<"image" | "order">("image");
  const [available, setAvailable] = useState(900),
    [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
      x: null,
      y: null,
    });
  const viewport = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const width =
    zoom === "fit"
      ? Math.min(1200, Math.max(200, available))
      : (PAGE_WIDTH * +zoom) / 100;
  const scale = width / PAGE_WIDTH;
  const height = Math.min(
    MAX_HEIGHT,
    Math.max(850, ...items.map((i) => i.canvas_y + i.canvas_height + 500)),
  );
  const active = items.find((i) => i.id === selected[0]);
  function present(next: CanvasImage[]) {
    itemsRef.current = next;
    setItems(next);
  }
  function commit(next: CanvasImage[], before = itemsRef.current) {
    setUndo((past) => [...past.slice(-49), before]);
    setRedo([]);
    present(next);
    setDirty(true);
  }
  async function save(internal = false) {
    if (busyRef.current && !internal)
      throw new Error("A page change is in progress");
    if (gesture.current) throw new Error("Finish the current gesture first");
    const snapshot = itemsRef.current;
    const saved = await saveCanvas(portfolio, pageId, snapshot);
    query.setQueryData(["page-images", portfolio, pageId], saved);
    if (itemsRef.current === snapshot) setDirty(false);
  }
  useImperativeHandle(ref, () => ({
    save,
    dirty: () => dirty || gesture.current !== null,
  }));
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setAvailable(entries[0].contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function history(direction: "undo" | "redo") {
    if (busy || gesture.current) return;
    const stack = direction === "undo" ? undo : redo;
    if (!stack.length) return;
    const next = stack[stack.length - 1];
    if (direction === "undo") {
      setUndo(stack.slice(0, -1));
      setRedo([...redo, items]);
    } else {
      setRedo(stack.slice(0, -1));
      setUndo([...undo, items]);
    }
    present(next);
    setDirty(true);
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest("input,textarea,select,dialog,[contenteditable]")
      )
        return;
      if (event.key === "Escape") {
        if (gesture.current) {
          present(gesture.current.before);
          gesture.current = null;
          setGuides({ x: null, y: null });
        }
        setSelected([]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        history(event.shiftKey ? "redo" : "undo");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(items.map((i) => i.id));
        return;
      }
      if (
        !selected.length ||
        busy ||
        mobile ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      const unit = event.shiftKey ? 10 : 1,
        dx =
          event.key === "ArrowLeft"
            ? -unit
            : event.key === "ArrowRight"
              ? unit
              : 0,
        dy =
          event.key === "ArrowUp"
            ? -unit
            : event.key === "ArrowDown"
              ? unit
              : 0;
      const box = bounds(items.filter((i) => selected.includes(i.id))),
        x = Math.max(-box.x, Math.min(PAGE_WIDTH - box.x - box.width, dx)),
        y = Math.max(-box.y, Math.min(MAX_HEIGHT - box.y - box.height, dy));
      commit(
        items.map((i) =>
          selected.includes(i.id)
            ? { ...i, canvas_x: i.canvas_x + x, canvas_y: i.canvas_y + y }
            : i,
        ),
      );
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function begin(
    event: ReactPointerEvent<HTMLDivElement>,
    image: CanvasImage,
    mode: "move" | "resize",
  ) {
    if (event.button !== 0 || busy || mobile) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.shiftKey && mode === "move") {
      setSelected((previous) =>
        previous.includes(image.id)
          ? previous.filter((id) => id !== image.id)
          : [...previous, image.id],
      );
      return;
    }
    const ids =
      mode === "resize"
        ? [image.id]
        : selected.includes(image.id)
          ? selected
          : [image.id];
    setSelected(ids);
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = canvas.current!.getBoundingClientRect();
    gesture.current = {
      pointer: event.pointerId,
      mode,
      startX: (event.clientX - rect.left) / scale,
      startY: (event.clientY - rect.top) / scale,
      before: itemsRef.current,
      ids,
      clientX: event.clientX,
      clientY: event.clientY,
      alt: event.altKey,
      shift: event.shiftKey,
    };
  }
  useEffect(() => {
    let animation = 0;
    function move() {
      const current = gesture.current,
        element = canvas.current,
        scroller = viewport.current;
      if (!current || !element || !scroller) {
        animation = 0;
        return;
      }
      const view = scroller.getBoundingClientRect();
      if (current.clientY > view.bottom - 70)
        scroller.scrollTop += Math.min(
          22,
          (current.clientY - view.bottom + 70) / 3,
        );
      if (current.clientY < view.top + 70)
        scroller.scrollTop -= Math.min(
          22,
          (view.top + 70 - current.clientY) / 3,
        );
      if (current.clientX > view.right - 50) scroller.scrollLeft += 12;
      if (current.clientX < view.left + 50) scroller.scrollLeft -= 12;
      const rect = element.getBoundingClientRect(),
        dx = (current.clientX - rect.left) / scale - current.startX,
        dy = (current.clientY - rect.top) / scale - current.startY;
      const chosen = current.before.filter((i) => current.ids.includes(i.id)),
        box = bounds(chosen);
      let x = box.x + dx,
        y = box.y + dy,
        gx: number | null = null,
        gy: number | null = null;
      if (current.mode === "move") {
        if (snap && !current.alt) {
          const others = current.before.filter(
            (i) => !current.ids.includes(i.id),
          );
          const targetsX = [
            0,
            PAGE_WIDTH / 2,
            PAGE_WIDTH,
            ...others.flatMap((i) => [
              i.canvas_x,
              i.canvas_x + i.canvas_width / 2,
              i.canvas_x + i.canvas_width,
            ]),
          ];
          const targetsY = [
            0,
            ...others.flatMap((i) => [
              i.canvas_y,
              i.canvas_y + i.canvas_height / 2,
              i.canvas_y + i.canvas_height,
            ]),
          ];
          if (grid) {
            for (let n = 0; n <= grid; n++)
              targetsX.push((n * PAGE_WIDTH) / grid);
            targetsY.push(
              (Math.round(y / (PAGE_WIDTH / grid)) * PAGE_WIDTH) / grid,
            );
          }
          const sx = snapAxis(x, box.width, targetsX, 7 / scale),
            sy = snapAxis(y, box.height, targetsY, 7 / scale);
          x = sx.value;
          y = sy.value;
          gx = sx.guide;
          gy = sy.guide;
        }
        x = Math.max(0, Math.min(PAGE_WIDTH - box.width, x));
        y = Math.max(0, Math.min(MAX_HEIGHT - box.height, y));
        present(
          current.before.map((i) =>
            current.ids.includes(i.id)
              ? {
                  ...i,
                  canvas_x: i.canvas_x + x - box.x,
                  canvas_y: i.canvas_y + y - box.y,
                }
              : i,
          ),
        );
      } else {
        const image = chosen[0];
        let w = Math.max(20, image.canvas_width + dx),
          h = Math.max(20, image.canvas_height + dy);
        if (current.shift) h = (w * image.canvas_height) / image.canvas_width;
        if (snap && !current.alt && grid) {
          const step = PAGE_WIDTH / grid,
            right = image.canvas_x + w,
            bottom = image.canvas_y + h;
          const rx = Math.round(right / step) * step,
            ry = Math.round(bottom / step) * step;
          if (Math.abs(rx - right) < 7 / scale) {
            w = rx - image.canvas_x;
            gx = rx;
          }
          if (!current.shift && Math.abs(ry - bottom) < 7 / scale) {
            h = ry - image.canvas_y;
            gy = ry;
          }
        }
        if (current.shift) h = (w * image.canvas_height) / image.canvas_width;
        present(
          current.before.map((i) =>
            i.id === image.id
              ? clampFrame({ ...i, canvas_width: w, canvas_height: h })
              : i,
          ),
        );
      }
      setGuides({ x: gx, y: gy });
      animation = requestAnimationFrame(move);
    }
    function pointer(event: PointerEvent) {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      current.clientX = event.clientX;
      current.clientY = event.clientY;
      current.alt = event.altKey;
      current.shift = event.shiftKey;
      if (!animation) animation = requestAnimationFrame(move);
    }
    function finish(event: PointerEvent) {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      cancelAnimationFrame(animation);
      animation = 0;
      gesture.current = null;
      setGuides({ x: null, y: null });
      if (event.type === "pointercancel") {
        present(current.before);
        return;
      }
      if (JSON.stringify(current.before) !== JSON.stringify(itemsRef.current)) {
        setUndo((past) => [...past.slice(-49), current.before]);
        setRedo([]);
        setDirty(true);
      }
    }
    window.addEventListener("pointermove", pointer);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [scale, snap, grid]);
  async function structural(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    let layoutSaved = false;
    try {
      await save(true);
      layoutSaved = true;
      await action();
      const fresh = await listPageImages(portfolio, pageId);
      const normalized = toCanvas(fresh, gap);
      const saved = await saveCanvas(portfolio, pageId, normalized);
      query.setQueryData(["page-images", portfolio, pageId], saved);
      present(toCanvas(saved, gap));
      setUndo([]);
      setRedo([]);
      setSelected([]);
      setDirty(false);
    } catch {
      try {
        if (layoutSaved) {
          const fresh = await listPageImages(portfolio, pageId);
          present(toCanvas(fresh, gap));
          setUndo([]);
          setRedo([]);
          setDirty(false);
        }
      } catch {
        /* Keep the visible layout if reloading also fails. */
      }
      setError(
        "Could not complete every change. The page has been refreshed where possible; please retry.",
      );
      throw new Error("Page change failed");
    } finally {
      setBusy(false);
    }
  }
  async function choose(images: Image[]) {
    if (picker === "replace" && active) {
      const image = images[0];
      commit(
        items.map((i) =>
          i.id === active.id
            ? {
                ...i,
                image_id: image.id,
                filename: image.filename,
                width: image.width,
                height: image.height,
                full_url: image.full_url,
                thumb_url: image.thumb_url,
              }
            : i,
        ),
      );
      setPicker(null);
      return;
    }
    await structural(async () => {
      for (const image of images)
        await addImageToPage(portfolio, pageId, image.id);
    });
    setPicker(null);
  }
  function patch(changes: Partial<CanvasImage>) {
    if (!active) return;
    commit(
      items.map((i) =>
        i.id === active.id ? clampFrame({ ...i, ...changes }) : i,
      ),
    );
  }
  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order);
  function reorder(index: number, delta: number) {
    const next = [...ordered],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next.map((image, sort_order) => ({ ...image, sort_order })));
  }
  return (
    <>
      <section className="workspace">
        <div className="canvas-toolbar">
          <div className="inline-actions">
            <h1>{title}</h1>
            <span className={`save-state ${dirty ? "unsaved" : ""}`}>
              {dirty ? "Unsaved layout" : "Layout saved"}
            </span>
          </div>
          <div className="inline-actions">
            <button
              className="icon-button"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              disabled={!undo.length || busy}
              onClick={() => history("undo")}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!redo.length || busy}
              onClick={() => history("redo")}
            >
              <Redo2 size={17} />
            </button>
            <span className="header-divider" />
            <button
              className={`studio-button ${mobile ? "active" : ""}`}
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <Monitor size={15} /> : <Smartphone size={15} />}{" "}
              {mobile ? "Canvas" : "Mobile preview"}
            </button>
            <button
              className="studio-button primary"
              disabled={busy}
              onClick={() => setPicker("add")}
            >
              <Plus size={15} />
              Add photographs
            </button>
          </div>
        </div>
        <div className="canvas-options">
          <div className="inline-actions">
            <label className="check-label">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              Snap to guides
            </label>
            <select
              aria-label="Grid guides"
              value={grid}
              onChange={(e) => setGrid(+e.target.value)}
            >
              <option value={0}>No grid</option>
              <option value={3}>3-column guides</option>
              <option value={12}>12-column guides</option>
            </select>
          </div>
          <label className="inline-actions">
            Zoom{" "}
            <select
              aria-label="Canvas zoom"
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
            >
              <option value="fit">Fit</option>
              <option value="50">50%</option>
              <option value="75">75%</option>
              <option value="100">100%</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}
        <div className="canvas-viewport" ref={viewport}>
          {mobile ? (
            <div className="mobile-preview" style={{ gap }}>
              <div className="mobile-preview-title">
                {title}
                <small>Reading order · full photographs</small>
              </div>
              {ordered.map((image) => (
                <img
                  key={image.id}
                  src={image.full_url}
                  alt={image.filename}
                  style={{ padding: matte }}
                />
              ))}
              {!items.length && <p>Add photographs to preview this page.</p>}
            </div>
          ) : (
            <div
              className="canvas-paper"
              ref={canvas}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setSelected([]);
              }}
              style={{
                width,
                height: height * scale,
                backgroundSize: grid
                  ? `${100 / grid}% ${(PAGE_WIDTH / grid) * scale}px`
                  : undefined,
                backgroundImage: grid
                  ? "linear-gradient(to right, #ece9e4 1px, transparent 1px), linear-gradient(to bottom, #ece9e4 1px, transparent 1px)"
                  : undefined,
              }}
            >
              {!items.length && (
                <div className="canvas-empty">
                  <Images size={35} />
                  <h2>A blank page. Your point of view.</h2>
                  <p>
                    Choose photographs from your library, then move and resize
                    them freely.
                  </p>
                  <button
                    className="studio-button primary"
                    onClick={() => setPicker("add")}
                  >
                    Choose photographs
                  </button>
                </div>
              )}
              {items.map((image) => (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${image.filename}`}
                  aria-pressed={selected.includes(image.id)}
                  key={image.id}
                  className={`canvas-frame ${selected.includes(image.id) ? "selected" : ""}`}
                  style={{
                    left: image.canvas_x * scale,
                    top: image.canvas_y * scale,
                    width: image.canvas_width * scale,
                    height: image.canvas_height * scale,
                    padding: matte * scale,
                  }}
                  onFocus={() => {
                    if (!selected.includes(image.id)) setSelected([image.id]);
                  }}
                  onPointerDown={(event) => begin(event, image, "move")}
                >
                  <img
                    src={image.full_url}
                    alt={image.filename}
                    draggable={false}
                    style={{
                      objectFit: image.image_fit,
                      objectPosition: `${image.position_x}% ${image.position_y}%`,
                    }}
                  />
                  {selected.includes(image.id) && (
                    <>
                      <span className="frame-label">
                        {Math.round(image.canvas_width)} ×{" "}
                        {Math.round(image.canvas_height)}
                      </span>
                      <div
                        className="frame-handle"
                        role="button"
                        aria-label={`Resize ${image.filename}`}
                        onPointerDown={(event) => begin(event, image, "resize")}
                      />
                    </>
                  )}
                </div>
              ))}
              {guides.x !== null && (
                <div
                  className="snap-line vertical"
                  style={{ left: guides.x * scale }}
                />
              )}
              {guides.y !== null && (
                <div
                  className="snap-line horizontal"
                  style={{ top: guides.y * scale }}
                />
              )}
              <div
                className="canvas-bottom-note"
                style={{ top: (height - 120) * scale }}
              >
                Room to keep going. Drag near the edge to scroll.
              </div>
            </div>
          )}
        </div>
        <div className="canvas-status">
          <span>
            {items.length} photographs · {selected.length} selected
          </span>
          <span>
            Shift-click: select multiple · Arrow keys: nudge · Alt: ignore
            guides
          </span>
        </div>
      </section>
      <aside className="inspector">
        <div className="inspector-tabs">
          <button
            className={inspector === "image" ? "active" : ""}
            onClick={() => setInspector("image")}
          >
            Photograph
          </button>
          <button
            className={inspector === "order" ? "active" : ""}
            onClick={() => setInspector("order")}
          >
            Mobile order
          </button>
        </div>
        {inspector === "order" ? (
          <div className="order-panel">
            <p className="studio-hint">
              This sequence is used on phones. Moving frames on the canvas does
              not change it.
            </p>
            {ordered.map((image, index) => (
              <div className="order-row" key={image.id}>
                <img src={image.thumb_url} alt="" />
                <button
                  className="order-title"
                  onClick={() => setSelected([image.id])}
                >
                  <small>{index + 1}</small>
                  {image.filename}
                </button>
                <div>
                  <button
                    className="icon-button"
                    disabled={index === 0}
                    aria-label={`Move ${image.filename} earlier`}
                    onClick={() => reorder(index, -1)}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={index === ordered.length - 1}
                    aria-label={`Move ${image.filename} later`}
                    onClick={() => reorder(index, 1)}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : !active ? (
          <div className="inspector-empty">
            <Images size={28} />
            <h2>A closer look</h2>
            <p>
              Select a photograph to adjust its frame and how it sits inside it.
            </p>
          </div>
        ) : (
          <div className="inspector-content">
            <div className="panel-label">
              {selected.length > 1
                ? `${selected.length} photographs selected`
                : "Selected photograph"}
            </div>
            <img
              className="inspector-preview"
              src={active.thumb_url}
              alt={active.filename}
            />
            <h2 title={active.filename}>{active.filename}</h2>
            {selected.length === 1 && (
              <>
                <div className="dimension-fields">
                  {(
                    [
                      "canvas_x",
                      "canvas_y",
                      "canvas_width",
                      "canvas_height",
                    ] as const
                  ).map((key, index) => (
                    <label key={key}>
                      {["X", "Y", "Width", "Height"][index]}
                      <input
                        type="number"
                        min={index < 2 ? 0 : 20}
                        max={
                          key === "canvas_y" || key === "canvas_height"
                            ? MAX_HEIGHT
                            : PAGE_WIDTH
                        }
                        step={1}
                        value={Math.round(active[key])}
                        onChange={(e) => {
                          if (Number.isFinite(e.target.valueAsNumber))
                            patch({ [key]: e.target.valueAsNumber });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Image mode
                  <select
                    value={active.image_fit}
                    onChange={(e) =>
                      patch({
                        image_fit: e.target.value as "cover" | "contain",
                      })
                    }
                  >
                    <option value="cover">Fill frame (crop)</option>
                    <option value="contain">Fit whole photograph</option>
                  </select>
                </label>
                {active.image_fit === "cover" && (
                  <>
                    <label>
                      Crop position · horizontal
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={active.position_x}
                        onChange={(e) => patch({ position_x: +e.target.value })}
                      />
                    </label>
                    <label>
                      Crop position · vertical
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={active.position_y}
                        onChange={(e) => patch({ position_y: +e.target.value })}
                      />
                    </label>
                  </>
                )}
                <button
                  className="studio-button"
                  onClick={() => setPicker("replace")}
                >
                  Replace photograph
                </button>
                <button
                  className="studio-button"
                  onClick={() =>
                    patch({
                      canvas_height: active.width
                        ? Math.max(
                            20,
                            (active.canvas_width * active.height) /
                              active.width,
                          )
                        : active.canvas_height,
                    })
                  }
                >
                  Use original proportions
                </button>
              </>
            )}
            <button
              className="studio-button danger"
              disabled={busy}
              onClick={() => {
                void structural(async () => {
                  for (const id of selected)
                    await removeImageFromPage(portfolio, pageId, id);
                }).catch(() => {});
              }}
            >
              <Trash2 size={14} />
              Remove {selected.length > 1 ? "selected" : "from page"}
            </button>
            <p className="studio-hint">
              Removing a placement keeps the original in your library. Additions
              and removals save the current layout and start a new undo history.
            </p>
          </div>
        )}
      </aside>
      <LibraryDialog
        open={picker !== null}
        onClose={() => {
          if (!busy) setPicker(null);
        }}
        onChoose={choose}
        excludedIds={picker === "replace" ? [] : items.map((i) => i.image_id)}
        single={picker === "replace"}
      />
    </>
  );
}
