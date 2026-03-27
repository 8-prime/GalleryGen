package admin

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

// AdminOnly middleware — must run after auth.Middleware. Rejects non-admins with 403.
func (h *Handler) AdminOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userIDStr, ok := auth.GetUserID(r.Context())
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var id pgtype.UUID
		if err := id.Scan(userIDStr); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		user, err := h.queries.GetUserByID(r.Context(), id)
		if err != nil || !user.IsAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.queries.ListAllUsers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	type userRow struct {
		ID                  string `json:"id"`
		Email               string `json:"email"`
		Plan                string `json:"plan"`
		CreatedAt           string `json:"created_at"`
		IsAdmin             bool   `json:"is_admin"`
		CanCreatePortfolio  bool   `json:"can_create_portfolio"`
		CanPublishPortfolio bool   `json:"can_publish_portfolio"`
	}
	rows := make([]userRow, len(users))
	for i, u := range users {
		rows[i] = userRow{
			ID:                  u.ID.String(),
			Email:               u.Email,
			Plan:                u.Plan,
			CreatedAt:           u.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
			IsAdmin:             u.IsAdmin,
			CanCreatePortfolio:  u.CanCreatePortfolio,
			CanPublishPortfolio: u.CanPublishPortfolio,
		}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *Handler) UpdateUserPermissions(w http.ResponseWriter, r *http.Request) {
	var id pgtype.UUID
	if err := id.Scan(chi.URLParam(r, "id")); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user id"})
		return
	}

	var body struct {
		IsAdmin             bool `json:"is_admin"`
		CanCreatePortfolio  bool `json:"can_create_portfolio"`
		CanPublishPortfolio bool `json:"can_publish_portfolio"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}

	user, err := h.queries.UpdateUserPermissions(r.Context(), generated.UpdateUserPermissionsParams{
		ID:                  id,
		IsAdmin:             body.IsAdmin,
		CanCreatePortfolio:  body.CanCreatePortfolio,
		CanPublishPortfolio: body.CanPublishPortfolio,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":                   user.ID.String(),
		"email":                user.Email,
		"is_admin":             user.IsAdmin,
		"can_create_portfolio": user.CanCreatePortfolio,
		"can_publish_portfolio": user.CanPublishPortfolio,
	})
}
