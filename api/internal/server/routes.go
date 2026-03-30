package server

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/galleryGen/api/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// statusWriter wraps ResponseWriter to capture the status code for logging.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(status int) {
	sw.status = status
	sw.ResponseWriter.WriteHeader(status)
}

// requestLogger is a structured slog middleware replacing chi's default Logger.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)

		level := slog.LevelInfo
		if sw.status >= 500 {
			level = slog.LevelError
		} else if sw.status >= 400 {
			level = slog.LevelWarn
		}
		slog.Log(r.Context(), level, "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

func (server *Server) registerRoutes() *chi.Mux {
	r := chi.NewRouter()
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Route("/api", func(r chi.Router) {
		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", server.authHandler.Register)
			r.Post("/login", server.authHandler.Login)
			r.Post("/refresh", server.authHandler.Refresh)
			r.Get("/oauth/{provider}", server.authHandler.OAuthRedirect)
			r.Get("/oauth/{provider}/callback", server.authHandler.OAuthCallback)
		})

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(server.baseConfig.JWTSecret))
			r.Get("/auth/me", server.authHandler.Me)
			r.Route("/portfolios", func(r chi.Router) {
				r.Get("/", server.portfolioHandler.List)
				r.Post("/", server.portfolioHandler.Create)
				r.Put("/{id}", server.portfolioHandler.Update)
				r.Delete("/{id}", server.portfolioHandler.Delete)

				// Main-page image endpoints (backward compat)
				r.Get("/{id}/images", server.portfolioHandler.ListImages)
				r.Post("/{id}/images", server.portfolioHandler.AddImage)
				r.Delete("/{id}/images/{itemId}", server.portfolioHandler.RemoveImage)

				// Pages CRUD
				r.Get("/{id}/pages", server.portfolioHandler.ListPages)
				r.Post("/{id}/pages", server.portfolioHandler.CreatePageHandler)
				r.Put("/{id}/pages/{pageId}", server.portfolioHandler.UpdatePageHandler)
				r.Delete("/{id}/pages/{pageId}", server.portfolioHandler.DeletePageHandler)

				// Page-specific image endpoints
				r.Get("/{id}/pages/{pageId}/images", server.portfolioHandler.ListPageImages)
				r.Post("/{id}/pages/{pageId}/images", server.portfolioHandler.AddPageImage)
				r.Post("/{id}/pages/{pageId}/images/reorder", server.portfolioHandler.ReorderPageImages)
				r.Delete("/{id}/pages/{pageId}/images/{itemId}", server.portfolioHandler.RemovePageImage)
				r.Patch("/{id}/pages/{pageId}/images/{itemId}", server.portfolioHandler.UpdateImageLayout)
			})
			r.Route("/images", func(r chi.Router) {
				r.Get("/", server.imageHandler.List)
				r.Post("/", server.imageHandler.Upload)
				r.Get("/{id}/raw", server.imageHandler.ServeRaw)
				r.Delete("/{id}", server.imageHandler.Delete)
			})
			r.Route("/admin", func(r chi.Router) {
				r.Use(server.adminHandler.AdminOnly)
				r.Get("/users", server.adminHandler.ListUsers)
				r.Patch("/users/{id}", server.adminHandler.UpdateUserPermissions)
			})
		})
	})

	// Public image serving (no auth — UUIDs are not guessable)
	r.Get("/media/{id}", server.imageHandler.ServePublic)
	// Public portfolio API (used by the editor preview)
	r.Get("/api/public/portfolios/{slug}", server.portfolioHandler.GetPublicPortfolio)
	// Server-rendered public portfolio pages
	r.Get("/p/{slug}", server.portfolioPageHandler.ServePortfolio)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	return r
}
