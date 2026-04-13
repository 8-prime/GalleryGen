package images

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/galleryGen/api/internal/auth"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if err := r.ParseMultipartForm(100 << 20); err != nil {
		slog.Error("upload: failed to parse multipart form", "user_id", userID, "err", err)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to parse form"})
		return
	}

	file, fh, err := r.FormFile("file")
	if err != nil {
		slog.Error("upload: missing file field", "user_id", userID, "err", err)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file field required"})
		return
	}
	_ = file

	slog.Debug("upload: starting", "user_id", userID, "filename", fh.Filename, "size", fh.Size, "content_type", fh.Header.Get("Content-Type"))

	//TODO:Get portfolio and page id from form
	img, err := h.svc.Upload(r.Context(), userID, nil, nil, fh)
	if err != nil {
		slog.Error("upload: service error", "user_id", userID, "filename", fh.Filename, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "upload failed"})
		return
	}

	slog.Info("upload: success", "user_id", userID, "image_id", img.ID, "filename", img.Filename)
	writeJSON(w, http.StatusCreated, img)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	limit := int32(50)
	offset := int32(0)
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = int32(n)
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = int32(n)
		}
	}

	result, err := h.svc.List(r.Context(), userID, limit, offset)
	if err != nil {
		slog.Error("list images: query failed", "user_id", userID, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list images"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ServeRaw(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.GetUserID(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	imageID := chi.URLParam(r, "id")
	raw, err := h.svc.Raw(r.Context(), userID, imageID)
	if err != nil {
		slog.Error("serve raw: not found or read error", "user_id", userID, "image_id", imageID, "err", err)
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", raw.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(raw.Data)
}

func (h *Handler) ServePublic(w http.ResponseWriter, r *http.Request) {
	imageID := chi.URLParam(r, "id")
	raw, err := h.svc.RawPublic(r.Context(), imageID)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", raw.ContentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write(raw.Data)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	imageID := chi.URLParam(r, "id")
	if err := h.svc.Delete(r.Context(), userID, imageID); err != nil {
		slog.Error("delete image: failed", "user_id", userID, "image_id", imageID, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "delete failed"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
