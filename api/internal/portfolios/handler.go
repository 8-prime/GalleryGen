package portfolios

import (
	"encoding/json"
	"net/http"

	"github.com/galleryGen/api/db/generated"
	"github.com/galleryGen/api/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Handler struct {
	queries *generated.Queries
}

func NewHandler(queries *generated.Queries) *Handler {
	return &Handler{queries: queries}
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
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if portfolios == nil {
		portfolios = []generated.Portfolio{}
	}
	writeJSON(w, http.StatusOK, portfolios)
}

func (h *Handler) RegisterRoutes(r chi.Router) {
	r.Get("/", h.List)
}
