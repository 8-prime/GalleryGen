package main

import (
	"log/slog"
	"os"

	"github.com/galleryGen/api/internal/config"
	"github.com/galleryGen/api/internal/server"
)

func main() {
	// JSON structured logging to stderr — easy to grep in container logs.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})))

	cfg := config.Load()
	server := server.NewServer(cfg)
	defer server.Close()
	server.Start()
}
