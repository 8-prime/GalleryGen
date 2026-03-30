package portfolios

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/galleryGen/api/db/generated"
	"github.com/galleryGen/api/internal/auth"
	"github.com/galleryGen/api/internal/images"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Handler struct {
	queries  *generated.Queries
	imgproxy *images.ImgproxyConfig
}

func NewHandler(queries *generated.Queries, imgproxy *images.ImgproxyConfig) *Handler {
	return &Handler{queries: queries, imgproxy: imgproxy}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	portfolios, err := h.queries.GetPortfoliosByUserID(r.Context(), userID)
	if err != nil {
		slog.ErrorContext(r.Context(), "portfolios.List: db query failed", "user_id", userIDStr, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if portfolios == nil {
		portfolios = []generated.Portfolio{}
	}
	writeJSON(w, http.StatusOK, portfolios)
}

var nonAlphanumeric = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(title string) string {
	s := strings.ToLower(title)
	s = nonAlphanumeric.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}

	user, err := h.queries.GetUserByID(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if !user.CanCreatePortfolio {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not permitted to create portfolios"})
		return
	}

	var body struct {
		Title       string  `json:"title"`
		Description *string `json:"description"`
		Slug        string  `json:"slug"`
		GapPx       int32   `json:"gap_px"`
		MattePx     int32   `json:"matte_px"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if body.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
		return
	}
	if body.Slug == "" {
		body.Slug = slugify(body.Title)
	}
	if body.GapPx < 0 {
		body.GapPx = 0
	}
	if body.MattePx < 0 {
		body.MattePx = 0
	}

	var desc pgtype.Text
	if body.Description != nil {
		desc = pgtype.Text{String: *body.Description, Valid: true}
	}
	p, err := h.queries.CreatePortfolio(r.Context(), generated.CreatePortfolioParams{
		UserID:      userID,
		Slug:        body.Slug,
		Title:       body.Title,
		Description: desc,
		GapPx:       body.GapPx,
		MattePx:     body.MattePx,
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "portfolios.Create: db insert failed", "user_id", userIDStr, "slug", body.Slug, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	var portfolioID pgtype.UUID
	if err := portfolioID.Scan(chi.URLParam(r, "id")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid portfolio id"})
		return
	}

	var body struct {
		Title       string  `json:"title"`
		Description *string `json:"description"`
		Slug        string  `json:"slug"`
		Published   bool    `json:"published"`
		GapPx       int32   `json:"gap_px"`
		MattePx     int32   `json:"matte_px"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if body.Published {
		updateUser, err := h.queries.GetUserByID(r.Context(), userID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		if !updateUser.CanPublishPortfolio {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "not permitted to publish portfolios"})
			return
		}
	}
	if body.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
		return
	}
	if body.Slug == "" {
		body.Slug = slugify(body.Title)
	}
	if body.GapPx < 0 {
		body.GapPx = 0
	}
	if body.MattePx < 0 {
		body.MattePx = 0
	}

	var desc pgtype.Text
	if body.Description != nil {
		desc = pgtype.Text{String: *body.Description, Valid: true}
	}

	p, err := h.queries.UpdatePortfolio(r.Context(), generated.UpdatePortfolioParams{
		ID:          portfolioID,
		UserID:      userID,
		Slug:        body.Slug,
		Title:       body.Title,
		Description: desc,
		Published:   pgtype.Bool{Bool: body.Published, Valid: true},
		GapPx:       body.GapPx,
		MattePx:     body.MattePx,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		slog.ErrorContext(r.Context(), "portfolios.Update: db update failed", "user_id", userIDStr, "portfolio_id", chi.URLParam(r, "id"), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}

	var portfolioID pgtype.UUID
	if err := portfolioID.Scan(chi.URLParam(r, "id")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid portfolio id"})
		return
	}

	if err := h.queries.DeletePortfolio(r.Context(), generated.DeletePortfolioParams{
		ID:     portfolioID,
		UserID: userID,
	}); err != nil {
		slog.ErrorContext(r.Context(), "portfolios.Delete: db delete failed", "user_id", userIDStr, "portfolio_id", chi.URLParam(r, "id"), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Pages CRUD ---

func (h *Handler) ListPages(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	portfolioIDStr := chi.URLParam(r, "id")
	var portfolioID pgtype.UUID
	if err := portfolioID.Scan(portfolioIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid portfolio id"})
		return
	}
	if !h.ownershipCheck(w, r, portfolioID, userID, userIDStr, portfolioIDStr) {
		return
	}
	pages, err := h.queries.GetPagesByPortfolioID(r.Context(), portfolioID)
	if err != nil {
		slog.ErrorContext(r.Context(), "ListPages: db query failed", "portfolio_id", portfolioIDStr, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if pages == nil {
		pages = []generated.Page{}
	}
	writeJSON(w, http.StatusOK, pages)
}

func (h *Handler) CreatePageHandler(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	portfolioIDStr := chi.URLParam(r, "id")
	var portfolioID pgtype.UUID
	if err := portfolioID.Scan(portfolioIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid portfolio id"})
		return
	}
	if !h.ownershipCheck(w, r, portfolioID, userID, userIDStr, portfolioIDStr) {
		return
	}

	var body struct {
		Title     string `json:"title"`
		Slug      string `json:"slug"`
		SortOrder int32  `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if body.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
		return
	}
	if body.Slug == "" {
		body.Slug = slugify(body.Title)
	}

	page, err := h.queries.CreatePage(r.Context(), generated.CreatePageParams{
		PortfolioID: portfolioID,
		Type:        "category",
		Slug:        body.Slug,
		Title:       body.Title,
		SortOrder:   body.SortOrder,
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "CreatePageHandler: db insert failed", "portfolio_id", portfolioIDStr, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusCreated, page)
}

func (h *Handler) UpdatePageHandler(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	portfolioIDStr := chi.URLParam(r, "id")
	var portfolioID pgtype.UUID
	if err := portfolioID.Scan(portfolioIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid portfolio id"})
		return
	}
	if !h.ownershipCheck(w, r, portfolioID, userID, userIDStr, portfolioIDStr) {
		return
	}
	var pageID pgtype.UUID
	if err := pageID.Scan(chi.URLParam(r, "pageId")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid page id"})
		return
	}

	var body struct {
		Title     string `json:"title"`
		Slug      string `json:"slug"`
		SortOrder int32  `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if body.Title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
		return
	}
	if body.Slug == "" {
		body.Slug = slugify(body.Title)
	}

	page, err := h.queries.UpdatePage(r.Context(), generated.UpdatePageParams{
		ID:          pageID,
		PortfolioID: portfolioID,
		Slug:        body.Slug,
		Title:       body.Title,
		SortOrder:   body.SortOrder,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		slog.ErrorContext(r.Context(), "UpdatePageHandler: db update failed", "page_id", chi.URLParam(r, "pageId"), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *Handler) DeletePageHandler(w http.ResponseWriter, r *http.Request) {
	userIDStr, ok := auth.GetUserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}
	portfolioIDStr := chi.URLParam(r, "id")
	var portfolioID pgtype.UUID
	if err := portfolioID.Scan(portfolioIDStr); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid portfolio id"})
		return
	}
	if !h.ownershipCheck(w, r, portfolioID, userID, userIDStr, portfolioIDStr) {
		return
	}
	var pageID pgtype.UUID
	if err := pageID.Scan(chi.URLParam(r, "pageId")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid page id"})
		return
	}

	if err := h.queries.DeletePage(r.Context(), generated.DeletePageParams{
		ID:          pageID,
		PortfolioID: portfolioID,
	}); err != nil {
		slog.ErrorContext(r.Context(), "DeletePageHandler: db delete failed", "page_id", chi.URLParam(r, "pageId"), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Public portfolio endpoint ---

type publicImageResponse struct {
	ID        string `json:"id"`
	ImageID   string `json:"image_id"`
	SortOrder int32  `json:"sort_order"`
	ColSpan   int32  `json:"col_span"`
	RowSpan   int32  `json:"row_span"`
	ColStart  int32  `json:"col_start"`
	RowStart  int32  `json:"row_start"`
	Filename  string `json:"filename"`
	Width     int32  `json:"width"`
	Height    int32  `json:"height"`
	URL       string `json:"url"`
}

type publicPageResponse struct {
	ID        string                `json:"id"`
	Title     string                `json:"title"`
	Slug      string                `json:"slug"`
	SortOrder int32                 `json:"sort_order"`
	Images    []publicImageResponse `json:"images"`
}

type publicPortfolioResponse struct {
	ID          string               `json:"id"`
	Title       string               `json:"title"`
	Description *string              `json:"description"`
	Pages       []publicPageResponse `json:"pages"`
}

func (h *Handler) GetPublicPortfolio(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	portfolio, err := h.queries.GetPublishedPortfolioBySlug(r.Context(), slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		slog.ErrorContext(r.Context(), "GetPublicPortfolio: db query failed", "slug", slug, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	pages, err := h.queries.GetPagesByPortfolioID(r.Context(), portfolio.ID)
	if err != nil {
		slog.ErrorContext(r.Context(), "GetPublicPortfolio: pages query failed", "slug", slug, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	pageResponses := make([]publicPageResponse, 0, len(pages))
	for _, page := range pages {
		rows, err := h.queries.GetGridItemsByPageID(r.Context(), page.ID)
		if err != nil {
			slog.ErrorContext(r.Context(), "GetPublicPortfolio: grid query failed", "page_id", page.ID.String(), "err", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		images := make([]publicImageResponse, len(rows))
		for i, row := range rows {
			var w2, h2 int32
			if row.Width.Valid {
				w2 = row.Width.Int32
			}
			if row.Height.Valid {
				h2 = row.Height.Int32
			}
			images[i] = publicImageResponse{
				ID:        row.ID.String(),
				ImageID:   row.ImageID.String(),
				SortOrder: row.SortOrder,
				ColSpan:   row.ColSpan,
				RowSpan:   row.RowSpan,
				ColStart:  row.ColStart,
				RowStart:  row.RowStart,
				Filename:  row.Filename,
				Width:     w2,
				Height:    h2,
				URL:       func() string {
				if h.imgproxy != nil && h.imgproxy.Enabled {
					return h.imgproxy.SignURL(row.StorageKey, 1600, 0)
				}
				return "/media/" + row.ImageID.String()
			}(),
			}
		}
		pageResponses = append(pageResponses, publicPageResponse{
			ID:        page.ID.String(),
			Title:     page.Title,
			Slug:      page.Slug,
			SortOrder: page.SortOrder,
			Images:    images,
		})
	}

	var desc *string
	if portfolio.Description.Valid {
		desc = &portfolio.Description.String
	}

	writeJSON(w, http.StatusOK, publicPortfolioResponse{
		ID:          portfolio.ID.String(),
		Title:       portfolio.Title,
		Description: desc,
		Pages:       pageResponses,
	})
}

func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Put("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)

	// Main-page image endpoints (backward compat)
	r.Get("/{id}/images", h.ListImages)
	r.Post("/{id}/images", h.AddImage)
	r.Delete("/{id}/images/{itemId}", h.RemoveImage)

	// Pages CRUD
	r.Get("/{id}/pages", h.ListPages)
	r.Post("/{id}/pages", h.CreatePageHandler)
	r.Put("/{id}/pages/{pageId}", h.UpdatePageHandler)
	r.Delete("/{id}/pages/{pageId}", h.DeletePageHandler)

	// Page-specific image endpoints
	r.Get("/{id}/pages/{pageId}/images", h.ListPageImages)
	r.Post("/{id}/pages/{pageId}/images", h.AddPageImage)
	r.Post("/{id}/pages/{pageId}/images/reorder", h.ReorderPageImages)
	r.Delete("/{id}/pages/{pageId}/images/{itemId}", h.RemovePageImage)
	r.Patch("/{id}/pages/{pageId}/images/{itemId}", h.UpdateImageLayout)
}
