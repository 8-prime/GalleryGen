package main

import (
	"context"
	"log"
	"net/http"
	"os"

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

func main() {
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
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	// Run migrations
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatalf("goose dialect: %v", err)
	}
	sqlDB := stdlib.OpenDBFromPool(pool)
	if err := goose.Up(sqlDB, "."); err != nil {
		log.Fatalf("goose up: %v", err)
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
	storage := images.NewLocalStorage(cfg.StoragePath)
	imageSvc := images.NewService(queries, storage, imgproxyCfg)
	imageHandler := images.NewHandler(imageSvc)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
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
				r.Get("/", portfolioHandler.List)
			})
			r.Route("/images", func(r chi.Router) {
				r.Get("/", imageHandler.List)
				r.Post("/", imageHandler.Upload)
				r.Get("/{id}/raw", imageHandler.ServeRaw)
				r.Delete("/{id}", imageHandler.Delete)
			})
		})
	})

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	if err := os.MkdirAll(cfg.StoragePath, 0755); err != nil {
		log.Fatalf("failed to create storage path: %v", err)
	}

	log.Printf("server listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		log.Fatal(err)
	}
}
