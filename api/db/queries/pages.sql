-- name: GetMainPageByPortfolioID :one
SELECT * FROM pages WHERE portfolio_id = $1 AND type = 'main' LIMIT 1;

-- name: GetPagesByPortfolioID :many
SELECT * FROM pages WHERE portfolio_id = $1 ORDER BY sort_order;

-- name: GetPageByID :one
SELECT * FROM pages WHERE id = $1 AND portfolio_id = $2;

-- name: CreatePage :one
INSERT INTO pages (portfolio_id, type, slug, title, sort_order)
VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdatePage :one
UPDATE pages SET slug = $2, title = $3, sort_order = $4
WHERE id = $1 AND portfolio_id = $5 RETURNING *;

-- name: DeletePage :exec
DELETE FROM pages WHERE id = $1 AND portfolio_id = $2;
