package images

import (
	"context"
	"io"
	"os"
	"path/filepath"
)

type Storage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

type LocalStorage struct {
	basePath string
}

func NewLocalStorage(basePath string) *LocalStorage {
	return &LocalStorage{basePath: basePath}
}

func (s *LocalStorage) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	fullPath := filepath.Join(s.basePath, key)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return err
	}
	f, err := os.Create(fullPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func (s *LocalStorage) Get(ctx context.Context, key string) ([]byte, error) {
	return os.ReadFile(filepath.Join(s.basePath, key))
}

func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	return os.Remove(filepath.Join(s.basePath, key))
}
