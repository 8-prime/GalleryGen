package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL        string
	JWTSecret          string
	Port               string
	StoragePath        string
	StorageBackend     string
	S3Endpoint         string
	S3Bucket           string
	S3AccessKey        string
	S3SecretKey        string
	ImgproxyEnabled    bool
	ImgproxyKey        string
	ImgproxySalt       string
	ImgproxyBaseURL    string
	GoogleClientID     string
	GoogleClientSecret string
	OIDCIssuerURL      string
	OIDCClientID       string
	OIDCClientSecret   string
	AppBaseURL         string
}

func Load() *Config {
	_ = godotenv.Load()
	c := &Config{
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		JWTSecret:          os.Getenv("JWT_SECRET"),
		Port:               getEnvOrDefault("PORT", "8080"),
		StoragePath:        getEnvOrDefault("STORAGE_PATH", "./data/images"),
		StorageBackend:     getEnvOrDefault("STORAGE_BACKEND", "local"),
		S3Endpoint:         os.Getenv("S3_ENDPOINT"),
		S3Bucket:           os.Getenv("S3_BUCKET"),
		S3AccessKey:        os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:        os.Getenv("S3_SECRET_KEY"),
		ImgproxyEnabled:    os.Getenv("IMGPROXY_ENABLED") == "true",
		ImgproxyKey:        os.Getenv("IMGPROXY_KEY"),
		ImgproxySalt:       os.Getenv("IMGPROXY_SALT"),
		ImgproxyBaseURL:    getEnvOrDefault("IMGPROXY_BASE_URL", "http://imgproxy:8080"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		OIDCIssuerURL:      os.Getenv("OIDC_ISSUER_URL"),
		OIDCClientID:       os.Getenv("OIDC_CLIENT_ID"),
		OIDCClientSecret:   os.Getenv("OIDC_CLIENT_SECRET"),
		AppBaseURL:         getEnvOrDefault("APP_BASE_URL", "http://localhost:8080"),
	}
	return c
}

func getEnvOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
