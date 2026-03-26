package auth

import (
	"context"
	"errors"

	"github.com/galleryGen/api/db/generated"
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
		PasswordHash: ptrStr(string(hash)),
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
	if user.PasswordHash == nil {
		return "", "", ErrInvalidCredentials
	}
	if err = bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)); err != nil {
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

func ptrStr(s string) *string { return &s }
