package generated

import (
	"github.com/jackc/pgx/v5/pgtype"
)

type User struct {
	ID               pgtype.UUID        `json:"id"`
	Email            string             `json:"email"`
	PasswordHash     *string            `json:"password_hash"`
	Plan             string             `json:"plan"`
	StripeCustomerID *string            `json:"stripe_customer_id"`
	CreatedAt        pgtype.Timestamptz `json:"created_at"`
}

type OauthAccount struct {
	ID             pgtype.UUID `json:"id"`
	UserID         pgtype.UUID `json:"user_id"`
	Provider       string      `json:"provider"`
	ProviderUserID string      `json:"provider_user_id"`
}

type Portfolio struct {
	ID          pgtype.UUID        `json:"id"`
	UserID      pgtype.UUID        `json:"user_id"`
	Slug        string             `json:"slug"`
	Title       string             `json:"title"`
	Description *string            `json:"description"`
	Published   pgtype.Bool        `json:"published"`
	CreatedAt   pgtype.Timestamptz `json:"created_at"`
}

type Image struct {
	ID         pgtype.UUID        `json:"id"`
	UserID     pgtype.UUID        `json:"user_id"`
	StorageKey string             `json:"storage_key"`
	Filename   string             `json:"filename"`
	MimeType   string             `json:"mime_type"`
	Width      pgtype.Int4        `json:"width"`
	Height     pgtype.Int4        `json:"height"`
	SizeBytes  pgtype.Int8        `json:"size_bytes"`
	CreatedAt  pgtype.Timestamptz `json:"created_at"`
}
