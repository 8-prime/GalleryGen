-- name: GetPortfoliosByUserID :many
SELECT * FROM portfolios WHERE user_id = $1 ORDER BY created_at DESC;

-- name: CreatePortfolio :one
INSERT INTO portfolios (user_id, slug, title, description, gap_px, matte_px)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdatePortfolio :one
UPDATE portfolios SET slug = $2, title = $3, description = $4, published = $5, gap_px = $6, matte_px = $7
WHERE id = $1 AND user_id = $8
RETURNING *;

-- name: GetPortfolioByID :one
SELECT * FROM portfolios WHERE id = $1 AND user_id = $2;

-- name: DeletePortfolio :exec
DELETE FROM portfolios WHERE id = $1 AND user_id = $2;

-- name: GetPublishedPortfolioBySlug :one
SELECT * FROM portfolios WHERE slug = $1 AND published = true;
