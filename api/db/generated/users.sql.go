package generated

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const createUser = `-- name: CreateUser :one
INSERT INTO users (email, password_hash)
VALUES ($1, $2)
RETURNING id, email, password_hash, plan, stripe_customer_id, created_at`

type CreateUserParams struct {
	Email        string  `json:"email"`
	PasswordHash *string `json:"password_hash"`
}

func (q *Queries) CreateUser(ctx context.Context, arg CreateUserParams) (User, error) {
	row := q.db.QueryRow(ctx, createUser, arg.Email, arg.PasswordHash)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.Plan,
		&i.StripeCustomerID,
		&i.CreatedAt,
	)
	return i, err
}

const getUserByEmail = `-- name: GetUserByEmail :one
SELECT id, email, password_hash, plan, stripe_customer_id, created_at FROM users WHERE email = $1`

func (q *Queries) GetUserByEmail(ctx context.Context, email string) (User, error) {
	row := q.db.QueryRow(ctx, getUserByEmail, email)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.Plan,
		&i.StripeCustomerID,
		&i.CreatedAt,
	)
	return i, err
}

const getUserByID = `-- name: GetUserByID :one
SELECT id, email, password_hash, plan, stripe_customer_id, created_at FROM users WHERE id = $1`

func (q *Queries) GetUserByID(ctx context.Context, id pgtype.UUID) (User, error) {
	row := q.db.QueryRow(ctx, getUserByID, id)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Email,
		&i.PasswordHash,
		&i.Plan,
		&i.StripeCustomerID,
		&i.CreatedAt,
	)
	return i, err
}

const upsertOAuthAccount = `-- name: UpsertOAuthAccount :exec
INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
VALUES ($1, $2, $3)
ON CONFLICT (provider, provider_user_id) DO NOTHING`

type UpsertOAuthAccountParams struct {
	UserID         pgtype.UUID `json:"user_id"`
	Provider       string      `json:"provider"`
	ProviderUserID string      `json:"provider_user_id"`
}

func (q *Queries) UpsertOAuthAccount(ctx context.Context, arg UpsertOAuthAccountParams) error {
	_, err := q.db.Exec(ctx, upsertOAuthAccount, arg.UserID, arg.Provider, arg.ProviderUserID)
	return err
}
