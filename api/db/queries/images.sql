-- name: CreateImage :one
INSERT INTO images (user_id, storage_key, filename, mime_type, width, height, size_bytes)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetImagesByUserID :many
SELECT * FROM images WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3;

-- name: CountImagesByUserID :one
SELECT COUNT(*) FROM images WHERE user_id = $1;

-- name: GetImageByID :one
SELECT * FROM images WHERE id = $1 AND user_id = $2;

-- name: DeleteImage :exec
DELETE FROM images WHERE id = $1 AND user_id = $2;

-- name: GetImageByIDPublic :one
SELECT * FROM images WHERE id = $1;
