-- name: CreateUser :one
INSERT INTO users (email, password_hash)
VALUES ($1, $2)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: UpsertOAuthAccount :exec
INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
VALUES ($1, $2, $3)
ON CONFLICT (provider, provider_user_id) DO NOTHING;
