package auth

import (
	"context"
	"errors"

	"github.com/galleryGen/api/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	queries   *generated.Queries
	jwtSecret string
}

func NewService(queries *generated.Queries, jwtSecret string) *Service {
	return &Service{queries: queries, jwtSecret: jwtSecret}
}

var ErrInvalidCredentials = errors.New("invalid credentials")

func (s *Service) Register(ctx context.Context, email, password string) (accessToken, refreshToken string, err error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return
	}
	user, err := s.queries.CreateUser(ctx, generated.CreateUserParams{
		Email:        email,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
	})
	if err != nil {
		return
	}
	return GenerateTokenPair(user.ID.String(), s.jwtSecret)
}

func (s *Service) Login(ctx context.Context, email, password string) (accessToken, refreshToken string, err error) {
	user, err := s.queries.GetUserByEmail(ctx, email)
	if err != nil {
		return "", "", ErrInvalidCredentials
	}
	if !user.PasswordHash.Valid {
		return "", "", ErrInvalidCredentials
	}
	if err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(password)); err != nil {
		return "", "", ErrInvalidCredentials
	}
	return GenerateTokenPair(user.ID.String(), s.jwtSecret)
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (accessToken, newRefresh string, err error) {
	claims, err := ValidateToken(refreshToken, s.jwtSecret)
	if err != nil {
		return
	}
	return GenerateTokenPair(claims.UserID, s.jwtSecret)
}

func (s *Service) GetCurrentUser(ctx context.Context, userIDStr string) (generated.User, error) {
	var id pgtype.UUID
	if err := id.Scan(userIDStr); err != nil {
		return generated.User{}, errors.New("invalid user id")
	}
	return s.queries.GetUserByID(ctx, id)
}

