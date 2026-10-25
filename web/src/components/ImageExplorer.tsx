import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Folder,
  FolderPlus,
  Images,
  Search,
  Upload,
  X,
  Check,
  Expand,
  Trash2,
  LoaderCircle,
} from "lucide-react";
import {
  createFolder,
  deleteFolder,
  deleteImage,
  listFolders,
  listImages,
  moveImages,
  renameFolder,
  uploadImage,
} from "../lib/images";
import type { Image } from "../lib/types";
import "../styles/studio.css";

interface Props {
  onChoose?: (images: Image[]) => Promise<void>;
  excludedIds?: string[];
  single?: boolean;
}

interface UploadState {
  current: number;
  total: number;
  filename: string;
  percent: number;
  destination: string;
}

export function ImageExplorer({
  onChoose,
  excludedIds = [],
  single = false,
}: Props) {
  const query = useQueryClient();
  const [folder, setFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState("newest");
  const [size, setSize] = useState(220);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<Record<string, Image>>({});
  const [busy, setBusy] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [uploadNotice, setUploadNotice] = useState("");
  const mutation = useRef(false);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [preview, setPreview] = useState<Image | null>(null);
  const previewRef = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const limit = 48;
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (preview) previewRef.current?.showModal();
    else previewRef.current?.close();
  }, [preview]);
  const folders = useQuery({ queryKey: ["folders"], queryFn: listFolders });
  const data = useQuery({
    queryKey: ["images", folder, term, sort, offset],
    queryFn: () => listImages(limit, offset, { folder, search: term, sort }),
  });
  const selected = Object.values(selection).filter(
    (image) => !excludedIds.includes(image.id),
  );
  const currentFolder = folders.data?.find((item) => item.id === folder);
  async function refreshLibrary() {
    await Promise.all([
      query.invalidateQueries({ queryKey: ["images"] }),
      query.invalidateQueries({ queryKey: ["folders"] }),
    ]);
  }
  async function perform(
    action: () => Promise<unknown>,
    failureMessage = "That change could not be completed. Please try again.",
  ) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refreshLibrary();
    } catch {
      setError(failureMessage);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  function chooseFolder(value: string) {
    setFolder(value);
    setOffset(0);
  }
  function toggle(image: Image) {
    setSelection((previous) => {
      if (single) return previous[image.id] ? {} : { [image.id]: image };
      const next = { ...previous };
      if (next[image.id]) delete next[image.id];
      else next[image.id] = image;
      return next;
    });
  }
  async function upload(files: FileList | null) {
    if (!files?.length || mutation.current) return;
    // Snapshot both before awaiting: folder navigation must not redirect a batch.
    const batch = Array.from(files);
    const folderId = folder === "all" || folder === "none" ? undefined : folder;
    const destination = folderId ? currentFolder?.name ?? "the selected folder" : "Unfiled";
    mutation.current = true;
    setBusy(true);
    setError("");
    setUploadNotice("");
    const failures: string[] = [];
    let uploaded = 0;
    try {
      for (const [index, file] of batch.entries()) {
        setUploadState({
          current: index + 1,
          total: batch.length,
          filename: file.name,
          percent: 0,
          destination,
        });
        try {
          await uploadImage(file, folderId, ({ loaded, total }) => {
            setUploadState((state) => state && {
              ...state,
              percent: total ? Math.min(100, Math.floor(loaded / total * 100)) : 100,
            });
          });
          uploaded++;
        } catch (cause) {
          const message = cause instanceof Error
            ? cause.message
            : "The upload failed. Please try again.";
          failures.push(`${file.name}: ${message}`);
        }
      }
      setUploadNotice(
        `${uploaded} of ${batch.length} photographs uploaded to ${destination}.${failures.length ? ` ${failures.length} failed.` : ""}`,
      );
      if (failures.length) setError(failures.join("\n"));
      // Successful files must appear even when another file in the batch fails.
      await refreshLibrary();
    } finally {
      mutation.current = false;
      setBusy(false);
      setUploadState(null);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="library-browser">
      <aside className="library-folders">
        <div className="panel-label">Your collection</div>
        <button
          className={folder === "all" ? "folder active" : "folder"}
          onClick={() => chooseFolder("all")}
        >
          <Images size={16} /> All photographs
        </button>
        <button
          className={folder === "none" ? "folder active" : "folder"}
          onClick={() => chooseFolder("none")}
        >
          <Folder size={16} /> Unfiled
        </button>
        <div className="folder-heading">
          <span className="panel-label">Folders</span>
          <button
            className="icon-button"
            title="New folder"
            aria-label="New folder"
            onClick={() => setNewFolder("")}
          >
            <FolderPlus size={16} />
          </button>
        </div>
        {newFolder !== null && (
          <form
            className="new-folder"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(
                async () => {
                  const result = await createFolder(newFolder);
                  chooseFolder(result.id);
                  setNewFolder(null);
                },
                "The folder could not be created. Choose a unique folder name and try again.",
              );
            }}
          >
            <input
              autoFocus
              aria-label="Folder name"
              placeholder="Folder name"
              maxLength={100}
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
            <button
              disabled={busy || !newFolder.trim()}
              aria-label="Create folder"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              aria-label="Cancel folder"
              onClick={() => setNewFolder(null)}
            >
              <X size={16} />
            </button>
          </form>
        )}
        {folders.data?.map((item) => (
          <button
            key={item.id}
            className={folder === item.id ? "folder active" : "folder"}
            onClick={() => chooseFolder(item.id)}
          >
            <Folder size={16} />
            <span>{item.name}</span>
            <small>{item.image_count}</small>
          </button>
        ))}
        <p className="library-hint">
          Folders organize your originals. Moving a photo keeps its portfolio
          placements intact.
        </p>
      </aside>
      <div className="library-main">
        <div className="library-toolbar">
          <label className="library-search">
            <Search size={17} />
            <input
              placeholder="Search filenames…"
              aria-label="Search photographs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Sort photographs"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setOffset(0);
            }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Filename</option>
          </select>
          <label className="thumbnail-size">
            Size{" "}
            <input
              aria-label="Thumbnail size"
              type="range"
              min={150}
              max={340}
              step={10}
              value={size}
              onChange={(e) => setSize(+e.target.value)}
            />
          </label>
          <button
            className="studio-button primary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {uploadState ? (
              <LoaderCircle size={15} className="upload-spinner" />
            ) : (
              <Upload size={15} />
            )}
            {uploadState ? "Uploading…" : busy ? "Working…" : "Upload"}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
        {uploadState ? (
          <div className="library-upload" aria-busy="true">
            <div className="upload-status" role="status">
              <strong>
                {uploadState.percent === 100 ? "Saving" : "Uploading"}{" "}
                {uploadState.current} of {uploadState.total}
              </strong>
              <span title={uploadState.filename}>{uploadState.filename}</span>
              <span>To {uploadState.destination}</span>
            </div>
            <progress
              aria-label={`Upload progress for ${uploadState.filename}`}
              max={100}
              value={uploadState.percent}
            />
            <span className="upload-percent">
              {uploadState.percent === 100
                ? "Waiting for the server to save this photograph…"
                : `${uploadState.percent}% of this file transferred`}
            </span>
          </div>
        ) : uploadNotice ? (
          <p className="library-upload-notice" role="status">
            {uploadNotice}
          </p>
        ) : null}
        <div className="library-context">
          <div>
            <h2>
              {currentFolder?.name ??
                (folder === "none" ? "Unfiled photographs" : "All photographs")}
            </h2>
            <span>
              {data.data?.total ?? "…"} photographs
              {term ? ` matching “${term}”` : ""}
            </span>
          </div>
          {currentFolder && (
            <div className="inline-actions">
              <button
                disabled={busy}
                onClick={() => {
                  const name = prompt("Rename folder", currentFolder.name);
                  if (name?.trim())
                    void perform(
                      () => renameFolder(currentFolder.id, name),
                      "The folder could not be renamed. Choose a unique folder name and try again.",
                    );
                }}
              >
                Rename
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Delete this folder? Its photographs will move to Unfiled.",
                    )
                  )
                    void perform(async () => {
                      await deleteFolder(currentFolder.id);
                      chooseFolder("none");
                    });
                }}
              >
                Delete folder
              </button>
            </div>
          )}
        </div>
        {(error || data.isError || folders.isError) && (
          <p className="studio-error" role="alert">
            {error || "The library could not be loaded. Please try again."}
          </p>
        )}
        <div
          className="library-scroll"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void upload(e.dataTransfer.files);
          }}
        >
          {data.isLoading ? (
            <p className="empty-message">Loading your photographs…</p>
          ) : !data.data?.images.length ? (
            <div className="empty-message">
              <Images size={36} />
              <h3>
                {term
                  ? "No matching photographs"
                  : "A little room for your work"}
              </h3>
              <p>
                {term
                  ? "Try a different filename or folder."
                  : "Upload photographs here, or drop files into this area."}
              </p>
            </div>
          ) : (
            <div
              className="library-grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${size}px), 1fr))`,
              }}
            >
              {data.data.images.map((image) => {
                const excluded = excludedIds.includes(image.id);
                return (
                  <article
                    key={image.id}
                    className={`library-tile ${selection[image.id] && !excluded ? "selected" : ""}`}
                  >
                    <button
                      className="photo-select"
                      disabled={excluded || busy}
                      onClick={() => toggle(image)}
                      aria-pressed={!!selection[image.id] && !excluded}
                      aria-label={`${excluded ? "Already on page" : "Select"} ${image.filename}`}
                    >
                      <img
                        src={image.thumb_url || image.full_url}
                        alt={image.filename}
                        loading="lazy"
                      />
                      <span className="selection-mark">
                        {excluded ? (
                          "On page"
                        ) : selection[image.id] ? (
                          <Check size={15} />
                        ) : (
                          <span />
                        )}
                      </span>
                    </button>
                    <button
                      className="photo-preview icon-button"
                      aria-label={`Preview ${image.filename}`}
                      onClick={() => setPreview(image)}
                    >
                      <Expand size={15} />
                    </button>
                    <div className="photo-meta">
                      <span title={image.filename}>{image.filename}</span>
                      <small>
                        {image.width} × {image.height}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <div className="library-bottom">
          <div className="inline-actions">
            <span>
              {selected.length
                ? `${selected.length} selected`
                : "Select photographs"}
            </span>
            {selected.length > 0 && (
              <button onClick={() => setSelection({})}>Clear</button>
            )}
          </div>
          <div className="inline-actions">
            <button
              className="studio-button"
              disabled={offset === 0 || busy}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span>{Math.floor(offset / limit) + 1}</span>
            <button
              className="studio-button"
              disabled={!data.data || offset + limit >= data.data.total || busy}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </button>
          </div>
        </div>
        <div className="library-selection-actions">
          {onChoose ? (
            <>
              <span>
                {single
                  ? "Choose a replacement. The frame will stay in place."
                  : "Choose photographs from any folder."}
              </span>
              <button
                className="studio-button primary"
                disabled={!selected.length || busy}
                onClick={() =>
                  void perform(async () => {
                    await onChoose(selected);
                    setSelection({});
                  })
                }
              >
                {busy && !uploadState
                  ? "Adding…"
                  : single
                    ? "Replace photograph"
                    : `Add ${selected.length || ""} to page`}
              </button>
            </>
          ) : (
            <>
              <select
                aria-label="Move selected photographs"
                disabled={!selected.length || busy}
                value=""
                onChange={(e) => {
                  const target = e.target.value;
                  void perform(async () => {
                    await moveImages(
                      selected.map((i) => i.id),
                      target === "none" ? null : target,
                    );
                    setSelection({});
                  });
                }}
              >
                <option value="" disabled>
                  Move selected to…
                </option>
                <option value="none">Unfiled</option>
                {folders.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                className="studio-button danger"
                disabled={!selected.length || busy}
                onClick={() => {
                  if (
                    confirm(
                      `Permanently delete ${selected.length} photographs and all their portfolio placements?`,
                    )
                  )
                    void perform(async () => {
                      for (const image of selected) await deleteImage(image.id);
                      setSelection({});
                    });
                }}
              >
                <Trash2 size={14} />
                Delete selected
              </button>
            </>
          )}
        </div>
      </div>
      <dialog
        ref={previewRef}
        className="photo-lightbox"
        onCancel={() => setPreview(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPreview(null);
        }}
      >
        <button
          className="icon-button lightbox-close"
          aria-label="Close preview"
          onClick={() => setPreview(null)}
        >
          <X />
        </button>
        {preview && (
          <figure>
            <img src={preview.full_url} alt={preview.filename} />
            <figcaption>
              {preview.filename} · {preview.width} × {preview.height}
            </figcaption>
          </figure>
        )}
      </dialog>
    </div>
  );
}

export function LibraryDialog({
  open,
  onClose,
  onChoose,
  excludedIds,
  single,
}: Props & { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open) ref.current?.close();
  }, [open]);
  return (
    <dialog className="library-dialog" ref={ref} onCancel={onClose}>
      <header>
        <div>
          <span className="panel-label">Your image library</span>
          <h2>{single ? "Replace photograph" : "Choose photographs"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close library"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <ImageExplorer
        onChoose={onChoose}
        excludedIds={excludedIds}
        single={single}
      />
    </dialog>
  );
}
