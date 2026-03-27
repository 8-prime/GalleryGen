package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/galleryGen/api/db"
	"github.com/galleryGen/api/db/generated"
	"github.com/galleryGen/api/internal/auth"
	"github.com/galleryGen/api/internal/config"
	"github.com/galleryGen/api/internal/images"
	"github.com/galleryGen/api/internal/portfolios"
	"github.com/galleryGen/api/migrations"
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

func main() {
	// JSON structured logging to stderr — easy to grep in container logs.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})))

	cfg := config.Load()

	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		slog.Error("goose dialect error", "err", err)
		os.Exit(1)
	}
	sqlDB := stdlib.OpenDBFromPool(pool)
	if err := goose.Up(sqlDB, "."); err != nil {
		slog.Error("goose up failed", "err", err)
		os.Exit(1)
	}

	queries := generated.New(pool)

	authSvc := auth.NewService(queries, cfg.JWTSecret)
	authHandler := auth.NewHandler(authSvc)
	portfolioHandler := portfolios.NewHandler(queries)

	imgproxyCfg := &images.ImgproxyConfig{
		Enabled: cfg.ImgproxyEnabled,
		Key:     cfg.ImgproxyKey,
		Salt:    cfg.ImgproxySalt,
		BaseURL: cfg.ImgproxyBaseURL,
	}

	portfolioPageHandler, err := portfolios.NewPageHandler(queries, imgproxyCfg)
	if err != nil {
		slog.Error("failed to load portfolio templates", "err", err)
		os.Exit(1)
	}

	storage := images.NewLocalStorage(cfg.StoragePath)
	imageSvc := images.NewService(queries, storage, imgproxyCfg)
	imageHandler := images.NewHandler(imageSvc)

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
			r.Post("/register", authHandler.Register)
			r.Post("/login", authHandler.Login)
			r.Post("/refresh", authHandler.Refresh)
			r.Get("/oauth/{provider}", authHandler.OAuthRedirect)
			r.Get("/oauth/{provider}/callback", authHandler.OAuthCallback)
		})

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(cfg.JWTSecret))
			r.Route("/portfolios", func(r chi.Router) {
				portfolioHandler.RegisterRoutes(r)
			})
			r.Route("/images", func(r chi.Router) {
				r.Get("/", imageHandler.List)
				r.Post("/", imageHandler.Upload)
				r.Get("/{id}/raw", imageHandler.ServeRaw)
				r.Delete("/{id}", imageHandler.Delete)
			})
		})
	})

	// Public image serving (no auth — UUIDs are not guessable)
	r.Get("/media/{id}", imageHandler.ServePublic)
	// Public portfolio API (used by the editor preview)
	r.Get("/api/public/portfolios/{slug}", portfolioHandler.GetPublicPortfolio)
	// Server-rendered public portfolio pages
	r.Get("/p/{slug}", portfolioPageHandler.ServePortfolio)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	if err := os.MkdirAll(cfg.StoragePath, 0755); err != nil {
		slog.Error("failed to create storage path", "path", cfg.StoragePath, "err", err)
		os.Exit(1)
	}

	slog.Info("server starting", "port", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}
