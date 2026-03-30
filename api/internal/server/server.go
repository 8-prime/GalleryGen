package server

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/galleryGen/api/db"
	"github.com/galleryGen/api/db/generated"
	"github.com/galleryGen/api/internal/admin"
	"github.com/galleryGen/api/internal/auth"
	"github.com/galleryGen/api/internal/config"
	"github.com/galleryGen/api/internal/images"
	"github.com/galleryGen/api/internal/portfolios"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"golang.org/x/crypto/bcrypt"
)

type Server struct {
	baseConfig           *config.Config
	imgproxyCfg          *images.ImgproxyConfig
	dbPool               *pgxpool.Pool
	queries              *generated.Queries
	authService          *auth.Service
	authHandler          *auth.Handler
	adminHandler         *admin.Handler
	storage              images.Storage
	imageService         *images.Service
	imageHandler         *images.Handler
	portfolioHandler     *portfolios.Handler
	portfolioPageHandler *portfolios.PageHandler
}

func ensureAdminUser(ctx context.Context, q *generated.Queries, cfg *config.Config) {
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return
	}
	_, err := q.GetUserByEmail(ctx, cfg.AdminEmail)
	if err != nil {
		hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), 12)
		if err != nil {
			slog.Error("failed to hash admin password", "err", err)
			return
		}
		if _, err = q.CreateUser(ctx, generated.CreateUserParams{
			Email:        cfg.AdminEmail,
			PasswordHash: pgtype.Text{String: string(hash), Valid: true},
		}); err != nil {
			slog.Error("failed to create admin user", "err", err)
			return
		}
		slog.Info("created admin user", "email", cfg.AdminEmail)
	}
	if err := q.SetUserAdmin(ctx, cfg.AdminEmail); err != nil {
		slog.Error("failed to set admin flag", "email", cfg.AdminEmail, "err", err)
	}
}

func NewServer(config *config.Config) *Server {
	ctx := context.Background()
	pool, err := db.NewPool(ctx, config.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "err", err)
		os.Exit(1)
	}
	queries := generated.New(pool)
	imgproxyCfg := &images.ImgproxyConfig{
		Enabled: config.ImgproxyEnabled,
		Key:     config.ImgproxyKey,
		Salt:    config.ImgproxySalt,
		BaseURL: config.ImgproxyBaseURL,
	}

	authSvc := auth.NewService(queries, config.JWTSecret)
	authHandler := auth.NewHandler(authSvc)
	adminHandler := admin.NewHandler(queries)
	portfolioPageHandler, err := portfolios.NewPageHandler(queries, imgproxyCfg)
	if err != nil {
		slog.Error("failed to load portfolio templates", "err", err)
		os.Exit(1)
	}

	storage := images.NewLocalStorage(config.StoragePath)
	imageSvc := images.NewService(queries, storage, imgproxyCfg)
	imageHandler := images.NewHandler(imageSvc)
	portfolioHandler := portfolios.NewHandler(queries, imgproxyCfg)

	server := Server{
		baseConfig:           config,
		imgproxyCfg:          imgproxyCfg,
		dbPool:               pool,
		queries:              queries,
		authService:          authSvc,
		authHandler:          authHandler,
		adminHandler:         adminHandler,
		storage:              storage,
		imageService:         imageSvc,
		imageHandler:         imageHandler,
		portfolioHandler:     portfolioHandler,
		portfolioPageHandler: portfolioPageHandler,
	}

	return &server
}

func (server *Server) Start() {
	sqlDB := stdlib.OpenDBFromPool(server.dbPool)
	if err := goose.Up(sqlDB, "."); err != nil {
		slog.Error("goose up failed", "err", err)
		os.Exit(1)
	}
	ctx := context.Background()
	ensureAdminUser(ctx, server.queries, server.baseConfig)

	if err := os.MkdirAll(server.baseConfig.StoragePath, 0755); err != nil {
		slog.Error("failed to create storage path", "path", server.baseConfig.StoragePath, "err", err)
		os.Exit(1)
	}
	slog.Info("server starting", "port", server.baseConfig.Port)
	if err := http.ListenAndServe(":"+server.baseConfig.Port, server.registerRoutes()); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

func (server *Server) Close() {
	server.dbPool.Close()
}
