package generated

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const getPortfoliosByUserID = `-- name: GetPortfoliosByUserID :many
SELECT id, user_id, slug, title, description, published, created_at FROM portfolios WHERE user_id = $1 ORDER BY created_at DESC`

func (q *Queries) GetPortfoliosByUserID(ctx context.Context, userID pgtype.UUID) ([]Portfolio, error) {
	rows, err := q.db.Query(ctx, getPortfoliosByUserID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Portfolio
	for rows.Next() {
		var i Portfolio
		if err := rows.Scan(
			&i.ID,
			&i.UserID,
			&i.Slug,
			&i.Title,
			&i.Description,
			&i.Published,
			&i.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

const createPortfolio = `-- name: CreatePortfolio :one
INSERT INTO portfolios (user_id, slug, title, description)
VALUES ($1, $2, $3, $4)
RETURNING id, user_id, slug, title, description, published, created_at`

type CreatePortfolioParams struct {
	UserID      pgtype.UUID `json:"user_id"`
	Slug        string      `json:"slug"`
	Title       string      `json:"title"`
	Description *string     `json:"description"`
}

func (q *Queries) CreatePortfolio(ctx context.Context, arg CreatePortfolioParams) (Portfolio, error) {
	row := q.db.QueryRow(ctx, createPortfolio, arg.UserID, arg.Slug, arg.Title, arg.Description)
	var i Portfolio
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.Slug,
		&i.Title,
		&i.Description,
		&i.Published,
		&i.CreatedAt,
	)
	return i, err
}

const updatePortfolio = `-- name: UpdatePortfolio :one
UPDATE portfolios SET slug = $2, title = $3, description = $4, published = $5
WHERE id = $1 AND user_id = $6
RETURNING id, user_id, slug, title, description, published, created_at`

type UpdatePortfolioParams struct {
	ID          pgtype.UUID `json:"id"`
	Slug        string      `json:"slug"`
	Title       string      `json:"title"`
	Description *string     `json:"description"`
	Published   pgtype.Bool `json:"published"`
	UserID      pgtype.UUID `json:"user_id"`
}

func (q *Queries) UpdatePortfolio(ctx context.Context, arg UpdatePortfolioParams) (Portfolio, error) {
	row := q.db.QueryRow(ctx, updatePortfolio, arg.ID, arg.Slug, arg.Title, arg.Description, arg.Published, arg.UserID)
	var i Portfolio
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.Slug,
		&i.Title,
		&i.Description,
		&i.Published,
		&i.CreatedAt,
	)
	return i, err
}

const deletePortfolio = `-- name: DeletePortfolio :exec
DELETE FROM portfolios WHERE id = $1 AND user_id = $2`

type DeletePortfolioParams struct {
	ID     pgtype.UUID `json:"id"`
	UserID pgtype.UUID `json:"user_id"`
}

func (q *Queries) DeletePortfolio(ctx context.Context, arg DeletePortfolioParams) error {
	_, err := q.db.Exec(ctx, deletePortfolio, arg.ID, arg.UserID)
	return err
}
