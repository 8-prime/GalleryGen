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

-- name: ListAllUsers :many
SELECT * FROM users ORDER BY created_at DESC;

-- name: UpdateUserPermissions :one
UPDATE users
SET is_admin = $2,
    can_create_portfolio = $3,
    can_publish_portfolio = $4
WHERE id = $1
RETURNING *;

-- name: SetUserAdmin :exec
UPDATE users SET is_admin = TRUE WHERE email = $1;
