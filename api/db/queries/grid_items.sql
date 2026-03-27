-- name: GetGridItemsByPageID :many
SELECT gi.id, gi.page_id, gi.image_id, gi.col_start, gi.row_start, gi.col_span, gi.row_span, gi.sort_order,
       i.storage_key, i.filename, i.mime_type, i.width, i.height
FROM grid_items gi JOIN images i ON gi.image_id = i.id
WHERE gi.page_id = $1 ORDER BY gi.sort_order;

-- name: CountGridItemsByPageID :one
SELECT COUNT(*) FROM grid_items WHERE page_id = $1;

-- name: CreateGridItem :one
INSERT INTO grid_items (page_id, image_id, col_start, row_start, col_span, row_span, sort_order)
VALUES ($1, $2, $3, $4, 1, 1, $5) RETURNING *;

-- name: DeleteGridItem :exec
DELETE FROM grid_items WHERE id = $1 AND page_id = $2;

-- name: UpdateGridItem :one
UPDATE grid_items SET col_span = $2, row_span = $3
WHERE id = $1 AND page_id = $4 RETURNING *;
