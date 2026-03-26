package images

import (
	"bytes"
	"context"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"image"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
	"time"

	"github.com/galleryGen/api/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct {
	queries  *generated.Queries
	storage  Storage
	imgproxy *ImgproxyConfig
}

func NewService(queries *generated.Queries, storage Storage, imgproxy *ImgproxyConfig) *Service {
	return &Service{queries: queries, storage: storage, imgproxy: imgproxy}
}

type ImageResponse struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	MimeType  string `json:"mime_type"`
	Width     int32  `json:"width"`
	Height    int32  `json:"height"`
	SizeBytes int64  `json:"size_bytes"`
	ThumbURL  string `json:"thumb_url"`
	FullURL   string `json:"full_url"`
	CreatedAt string `json:"created_at"`
}

func (s *Service) Upload(ctx context.Context, userIDStr string, fh *multipart.FileHeader) (*ImageResponse, error) {
	f, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// Read all to detect dimensions
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	var width, height int
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err == nil {
		width = cfg.Width
		height = cfg.Height
	}

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	storageKey := fmt.Sprintf("%s/%d%s", userIDStr, time.Now().UnixNano(), ext)

	if err := s.storage.Put(ctx, storageKey, bytes.NewReader(data), fh.Size, fh.Header.Get("Content-Type")); err != nil {
		return nil, err
	}

	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		return nil, err
	}

	img, err := s.queries.CreateImage(ctx, generated.CreateImageParams{
		UserID:     userID,
		StorageKey: storageKey,
		Filename:   fh.Filename,
		MimeType:   fh.Header.Get("Content-Type"),
		Width:      pgtype.Int4{Int32: int32(width), Valid: width > 0},
		Height:     pgtype.Int4{Int32: int32(height), Valid: height > 0},
		SizeBytes:  pgtype.Int8{Int64: fh.Size, Valid: true},
	})
	if err != nil {
		return nil, err
	}

	return toResponse(img, s.imgproxy), nil
}

type ListResult struct {
	Images []ImageResponse `json:"images"`
	Total  int64           `json:"total"`
	Limit  int32           `json:"limit"`
	Offset int32           `json:"offset"`
}

func (s *Service) List(ctx context.Context, userIDStr string, limit, offset int32) (*ListResult, error) {
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		return nil, err
	}

	total, err := s.queries.CountImagesByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	imgs, err := s.queries.GetImagesByUserID(ctx, generated.GetImagesByUserIDParams{
		UserID: userID,
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		return nil, err
	}

	responses := make([]ImageResponse, len(imgs))
	for i, img := range imgs {
		responses[i] = *toResponse(img, s.imgproxy)
	}

	return &ListResult{
		Images: responses,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}, nil
}

type RawImage struct {
	Data        []byte
	ContentType string
	Filename    string
}

func (s *Service) Raw(ctx context.Context, userIDStr, imageIDStr string) (*RawImage, error) {
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		return nil, err
	}
	var imageID pgtype.UUID
	if err := imageID.Scan(imageIDStr); err != nil {
		return nil, err
	}
	img, err := s.queries.GetImageByID(ctx, generated.GetImageByIDParams{ID: imageID, UserID: userID})
	if err != nil {
		return nil, err
	}
	data, err := s.storage.Get(ctx, img.StorageKey)
	if err != nil {
		return nil, err
	}
	return &RawImage{Data: data, ContentType: img.MimeType, Filename: img.Filename}, nil
}

func (s *Service) Delete(ctx context.Context, userIDStr, imageIDStr string) error {
	var userID pgtype.UUID
	if err := userID.Scan(userIDStr); err != nil {
		return err
	}
	var imageID pgtype.UUID
	if err := imageID.Scan(imageIDStr); err != nil {
		return err
	}

	img, err := s.queries.GetImageByID(ctx, generated.GetImageByIDParams{ID: imageID, UserID: userID})
	if err != nil {
		return err
	}

	if err := s.storage.Delete(ctx, img.StorageKey); err != nil {
		// log but don't fail — DB record removal is more important
		_ = err
	}

	return s.queries.DeleteImage(ctx, generated.DeleteImageParams{ID: imageID, UserID: userID})
}

func toResponse(img generated.Image, cfg *ImgproxyConfig) *ImageResponse {
	id := img.ID.String()
	thumbURL := "/api/images/" + id + "/raw"
	fullURL := "/api/images/" + id + "/raw"
	if cfg != nil && cfg.Enabled {
		thumbURL = cfg.SignURL(img.StorageKey, 400, 400)
		fullURL = cfg.SignURL(img.StorageKey, 1600, 0)
	}
	var w, h int32
	if img.Width.Valid {
		w = img.Width.Int32
	}
	if img.Height.Valid {
		h = img.Height.Int32
	}
	var size int64
	if img.SizeBytes.Valid {
		size = img.SizeBytes.Int64
	}
	return &ImageResponse{
		ID:        img.ID.String(),
		Filename:  img.Filename,
		MimeType:  img.MimeType,
		Width:     w,
		Height:    h,
		SizeBytes: size,
		ThumbURL:  thumbURL,
		FullURL:   fullURL,
		CreatedAt: img.CreatedAt.Time.Format(time.RFC3339),
	}
}
