package portfolios

import (
	"embed"
	"errors"
	"html/template"
	"log/slog"
	"net/http"

	"github.com/galleryGen/api/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

//go:embed templates/*.html
var templateFS embed.FS

// PageHandler renders published portfolios as server-side HTML.
type PageHandler struct {
	queries *generated.Queries
	tmpl    *template.Template
}

func NewPageHandler(queries *generated.Queries) (*PageHandler, error) {
	tmpl, err := template.ParseFS(templateFS, "templates/portfolio.html")
	if err != nil {
		return nil, err
	}
	return &PageHandler{queries: queries, tmpl: tmpl}, nil
}

type imageTemplateData struct {
	ImageID  string
	ColStart int32
	ColSpan  int32
	RowStart int32
	RowSpan  int32
	Width    int32
	Height   int32
	Filename string
}

type pageTemplateData struct {
	Slug   string
	Title  string
	Images []imageTemplateData
}

type portfolioTemplateData struct {
	Title       string
	Description string
	Pages       []pageTemplateData
}

func (h *PageHandler) ServePortfolio(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	portfolio, err := h.queries.GetPublishedPortfolioBySlug(r.Context(), slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		slog.ErrorContext(r.Context(), "ServePortfolio: db query failed", "slug", slug, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	pages, err := h.queries.GetPagesByPortfolioID(r.Context(), portfolio.ID)
	if err != nil {
		slog.ErrorContext(r.Context(), "ServePortfolio: pages query failed", "slug", slug, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	pageData := make([]pageTemplateData, 0, len(pages))
	for _, page := range pages {
		rows, err := h.queries.GetGridItemsByPageID(r.Context(), page.ID)
		if err != nil {
			slog.ErrorContext(r.Context(), "ServePortfolio: grid query failed", "page_id", page.ID.String(), "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		images := make([]imageTemplateData, len(rows))
		for i, row := range rows {
			var w2, h2 int32
			if row.Width.Valid {
				w2 = row.Width.Int32
			}
			if row.Height.Valid {
				h2 = row.Height.Int32
			}
			images[i] = imageTemplateData{
				ImageID:  row.ImageID.String(),
				ColStart: row.ColStart,
				ColSpan:  row.ColSpan,
				RowStart: row.RowStart,
				RowSpan:  row.RowSpan,
				Width:    w2,
				Height:   h2,
				Filename: row.Filename,
			}
		}
		pageData = append(pageData, pageTemplateData{
			Slug:   page.Slug,
			Title:  page.Title,
			Images: images,
		})
	}

	var desc string
	if portfolio.Description.Valid {
		desc = portfolio.Description.String
	}

	data := portfolioTemplateData{
		Title:       portfolio.Title,
		Description: desc,
		Pages:       pageData,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := h.tmpl.Execute(w, data); err != nil {
		slog.ErrorContext(r.Context(), "ServePortfolio: template render failed", "slug", slug, "err", err)
	}
}
