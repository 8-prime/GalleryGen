package portfolios

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/galleryGen/api/db/generated"
	"github.com/galleryGen/api/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type portfolioImageResponse struct {
	ID        string `json:"id"`
	ImageID   string `json:"image_id"`
	SortOrder int32  `json:"sort_order"`
	ColSpan   int32  `json:"col_span"`
	RowSpan   int32  `json:"row_span"`
	ColStart  int32  `json:"col_start"`
	RowStart  int32  `json:"row_start"`
	Filename  string `json:"filename"`
	MimeType  string `json:"mime_type"`
	Width     int32  `json:"width"`
	Height    int32  `json:"height"`
	ThumbURL  string `json:"thumb_url"`
	FullURL   string `json:"full_url"`
}

func toPortfolioImageResponse(row generated.GetGridItemsByPageIDRow) portfolioImageResponse {
	imageID := row.ImageID.String()
	url := "/media/" + imageID
	var w, h int32
	if row.Width.Valid {
		w = row.Width.Int32
	}
	if row.Height.Valid {
		h = row.Height.Int32
	}
	return portfolioImageResponse{
		ID:        row.ID.String(),
		ImageID:   imageID,
		SortOrder: row.SortOrder,
		ColSpan:   row.ColSpan,
		RowSpan:   row.RowSpan,
		ColStart:  row.ColStart,
		RowStart:  row.RowStart,
		Filename:  row.Filename,
		MimeType:  row.MimeType,
		Width:     w,
		Height:    h,
		ThumbURL:  url,
		FullURL:   url,
	}
}

func (h *Handler) getOrCreateMainPage(r *http.Request, portfolioID pgtype.UUID) (generated.Page, error) {
	page, err := h.queries.GetMainPageByPortfolioID(r.Context(), portfolioID)
	if err == nil {
		return page, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(r.Context(), "getOrCreateMainPage: db lookup failed", "portfolio_id", portfolioID.String(), "err", err)
		return generated.Page{}, err
	}
	page, err = h.queries.CreatePage(r.Context(), generated.CreatePageParams{
		PortfolioID: portfolioID,
		Type:        "main",
		Slug:        "main",
		Title:       "Main",
		SortOrder:   0,
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "getOrCreateMainPage: db create failed", "portfolio_id", portfolioID.String(), "err", err)
	}
	return page, err
}

// ownershipCheck returns the portfolio if the user owns it, else writes an error response.
func (h *Handler) ownershipCheck(w http.ResponseWriter, r *http.Request, portfolioID pgtype.UUID, userID pgtype.UUID, userIDStr, portfolioIDStr string) bool {
	if _, err := h.queries.GetPortfolioByID(r.Context(), generated.GetPortfolioByIDParams{
		ID: portfolioID, UserID: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return false
		}
		slog.ErrorContext(r.Context(), "ownership check failed", "user_id", userIDStr, "portfolio_id", portfolioIDStr, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return false
	}
	return true
}

// --- Main-page image endpoints (backward compat) ---

func (h *Handler) ListImages(w http.ResponseWriter, r *http.Request) {
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

	page, err := h.getOrCreateMainPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	h.listImagesForPage(w, r, page.ID)
}

func (h *Handler) AddImage(w http.ResponseWriter, r *http.Request) {
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

	page, err := h.getOrCreateMainPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	h.addImageToPage(w, r, page.ID, userID, userIDStr)
}

func (h *Handler) RemoveImage(w http.ResponseWriter, r *http.Request) {
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

	page, err := h.getOrCreateMainPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	h.removeImageFromPage(w, r, page.ID)
}

// --- Page-specific image endpoints ---

func (h *Handler) ListPageImages(w http.ResponseWriter, r *http.Request) {
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
	page, err := h.getPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}
	h.listImagesForPage(w, r, page.ID)
}

func (h *Handler) AddPageImage(w http.ResponseWriter, r *http.Request) {
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
	page, err := h.getPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}
	h.addImageToPage(w, r, page.ID, userID, userIDStr)
}

func (h *Handler) RemovePageImage(w http.ResponseWriter, r *http.Request) {
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
	page, err := h.getPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}
	h.removeImageFromPage(w, r, page.ID)
}

func (h *Handler) UpdateImageLayout(w http.ResponseWriter, r *http.Request) {
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
	page, err := h.getPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	var itemID pgtype.UUID
	if err := itemID.Scan(chi.URLParam(r, "itemId")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid item id"})
		return
	}

	var body struct {
		ColSpan int32 `json:"col_span"`
		RowSpan int32 `json:"row_span"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if body.ColSpan < 1 {
		body.ColSpan = 1
	}
	if body.RowSpan < 1 {
		body.RowSpan = 1
	}

	item, err := h.queries.UpdateGridItem(r.Context(), generated.UpdateGridItemParams{
		ID:      itemID,
		PageID:  page.ID,
		ColSpan: body.ColSpan,
		RowSpan: body.RowSpan,
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "UpdateImageLayout: db update failed", "item_id", chi.URLParam(r, "itemId"), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	url := "/img/" + item.ImageID.String()
	writeJSON(w, http.StatusOK, portfolioImageResponse{
		ID:        item.ID.String(),
		ImageID:   item.ImageID.String(),
		SortOrder: item.SortOrder,
		ColSpan:   item.ColSpan,
		RowSpan:   item.RowSpan,
		ColStart:  item.ColStart,
		RowStart:  item.RowStart,
		ThumbURL:  url,
		FullURL:   url,
	})
}

// --- Shared helpers ---

func (h *Handler) getPage(r *http.Request, portfolioID pgtype.UUID) (generated.Page, error) {
	var pageID pgtype.UUID
	if err := pageID.Scan(chi.URLParam(r, "pageId")); err != nil {
		return generated.Page{}, err
	}
	return h.queries.GetPageByID(r.Context(), generated.GetPageByIDParams{
		ID:          pageID,
		PortfolioID: portfolioID,
	})
}

func (h *Handler) listImagesForPage(w http.ResponseWriter, r *http.Request, pageID pgtype.UUID) {
	rows, err := h.queries.GetGridItemsByPageID(r.Context(), pageID)
	if err != nil {
		slog.ErrorContext(r.Context(), "listImagesForPage: grid query failed", "page_id", pageID.String(), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	result := make([]portfolioImageResponse, len(rows))
	for i, row := range rows {
		result[i] = toPortfolioImageResponse(row)
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) addImageToPage(w http.ResponseWriter, r *http.Request, pageID pgtype.UUID, userID pgtype.UUID, userIDStr string) {
	var body struct {
		ImageID string `json:"image_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	var imageID pgtype.UUID
	if err := imageID.Scan(body.ImageID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid image id"})
		return
	}
	if _, err := h.queries.GetImageByID(r.Context(), generated.GetImageByIDParams{
		ID: imageID, UserID: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "image not found"})
			return
		}
		slog.ErrorContext(r.Context(), "addImageToPage: image lookup failed", "user_id", userIDStr, "image_id", body.ImageID, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	count, err := h.queries.CountGridItemsByPageID(r.Context(), pageID)
	if err != nil {
		slog.ErrorContext(r.Context(), "addImageToPage: count failed", "page_id", pageID.String(), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	item, err := h.queries.CreateGridItem(r.Context(), generated.CreateGridItemParams{
		PageID:    pageID,
		ImageID:   imageID,
		ColStart:  1,
		RowStart:  int32(count) + 1,
		SortOrder: int32(count),
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "addImageToPage: db insert failed", "page_id", pageID.String(), "image_id", body.ImageID, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	url := "/img/" + item.ImageID.String()
	writeJSON(w, http.StatusCreated, portfolioImageResponse{
		ID:        item.ID.String(),
		ImageID:   item.ImageID.String(),
		SortOrder: item.SortOrder,
		ColSpan:   item.ColSpan,
		RowSpan:   item.RowSpan,
		ColStart:  item.ColStart,
		RowStart:  item.RowStart,
		ThumbURL:  url,
		FullURL:   url,
	})
}

func (h *Handler) ReorderPageImages(w http.ResponseWriter, r *http.Request) {
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
	page, err := h.getPage(r, portfolioID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "page not found"})
		return
	}

	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}

	for i, idStr := range body.IDs {
		var itemID pgtype.UUID
		if err := itemID.Scan(idStr); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid item id: " + idStr})
			return
		}
		if _, err := h.queries.UpdateGridItemSortOrder(r.Context(), generated.UpdateGridItemSortOrderParams{
			ID:        itemID,
			SortOrder: int32(i),
			PageID:    page.ID,
		}); err != nil {
			slog.ErrorContext(r.Context(), "ReorderPageImages: db update failed", "item_id", idStr, "err", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) removeImageFromPage(w http.ResponseWriter, r *http.Request, pageID pgtype.UUID) {
	var itemID pgtype.UUID
	if err := itemID.Scan(chi.URLParam(r, "itemId")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid item id"})
		return
	}
	if err := h.queries.DeleteGridItem(r.Context(), generated.DeleteGridItemParams{
		ID:     itemID,
		PageID: pageID,
	}); err != nil {
		slog.ErrorContext(r.Context(), "removeImageFromPage: db delete failed", "item_id", chi.URLParam(r, "itemId"), "page_id", pageID.String(), "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
