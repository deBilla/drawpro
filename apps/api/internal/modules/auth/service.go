package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"

	apperr "github.com/deBilla/drawpro-api/internal/core/errors"
	jwtutil "github.com/deBilla/drawpro-api/internal/core/jwt"
)

// TokenPair holds a newly-issued access + refresh token pair.
type TokenPair struct {
	AccessToken  string
	RefreshToken string
}

// ServiceConfig holds JWT and token TTL settings.
type ServiceConfig struct {
	AccessSecret  string
	RefreshSecret string
	AccessTTL     time.Duration
	RefreshTTL    time.Duration
}

// Service defines all auth operations.
type Service interface {
	Register(ctx context.Context, req RegisterRequest) (*Entity, *TokenPair, error)
	Login(ctx context.Context, req LoginRequest) (*Entity, *TokenPair, error)
	Refresh(ctx context.Context, refreshToken string) (*TokenPair, error)
	Logout(ctx context.Context, refreshToken string) error
	Me(ctx context.Context, userID string) (*Entity, error)
	SetKeys(ctx context.Context, userID string, req SetKeysRequest) (*Entity, error)
}

type service struct {
	repo  Repository
	redis *redis.Client
	cfg   ServiceConfig
	log   *zap.Logger
}

// NewService constructs a Service.
func NewService(repo Repository, redisClient *redis.Client, cfg ServiceConfig, log *zap.Logger) Service {
	return &service{repo: repo, redis: redisClient, cfg: cfg, log: log}
}

func (s *service) Register(ctx context.Context, req RegisterRequest) (*Entity, *TokenPair, error) {
	if existing, err := s.repo.GetByEmail(ctx, req.Email); err == nil && existing != nil {
		return nil, nil, fmt.Errorf("auth.service.Register: %w", apperr.ErrConflict)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return nil, nil, fmt.Errorf("auth.service.Register: hash: %w", err)
	}

	entity, err := s.repo.Create(ctx, CreateParams{
		Email:        req.Email,
		PasswordHash: string(hash),
		Name:         req.Name,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("auth.service.Register: %w", err)
	}

	pair, err := s.issueTokens(ctx, entity.ID)
	if err != nil {
		return nil, nil, err
	}
	return entity, pair, nil
}

func (s *service) Login(ctx context.Context, req LoginRequest) (*Entity, *TokenPair, error) {
	entity, err := s.repo.GetByEmail(ctx, req.Email)
	if err != nil {
		s.log.Warn("login: GetByEmail failed", zap.String("email", req.Email), zap.Error(err))
		return nil, nil, fmt.Errorf("auth.service.Login: %w", apperr.ErrUnauthorized)
	}

	hashPrefix := ""
	if len(entity.PasswordHash) >= 7 {
		hashPrefix = entity.PasswordHash[:7]
	}
	s.log.Info("login: comparing hash",
		zap.Int("hash_len", len(entity.PasswordHash)),
		zap.String("hash_prefix", hashPrefix),
		zap.Int("password_len", len(req.Password)),
	)
	if err := bcrypt.CompareHashAndPassword([]byte(entity.PasswordHash), []byte(req.Password)); err != nil {
		s.log.Warn("login: password mismatch", zap.String("email", req.Email), zap.Error(err))
		return nil, nil, fmt.Errorf("auth.service.Login: %w", apperr.ErrUnauthorized)
	}

	pair, err := s.issueTokens(ctx, entity.ID)
	if err != nil {
		return nil, nil, err
	}
	return entity, pair, nil
}

func (s *service) Refresh(ctx context.Context, refreshToken string) (*TokenPair, error) {
	claims, err := jwtutil.ParseToken(refreshToken, s.cfg.RefreshSecret)
	if err != nil {
		return nil, fmt.Errorf("auth.service.Refresh: %w", apperr.ErrUnauthorized)
	}

	key := fmt.Sprintf("rt:%s:%s", claims.Subject, claims.ID)
	if err := s.redis.Get(ctx, key).Err(); err != nil {
		return nil, fmt.Errorf("auth.service.Refresh: token revoked: %w", apperr.ErrUnauthorized)
	}
	s.redis.Del(ctx, key)

	return s.issueTokens(ctx, claims.Subject)
}

func (s *service) Logout(ctx context.Context, refreshToken string) error {
	claims, err := jwtutil.ParseToken(refreshToken, s.cfg.RefreshSecret)
	if err != nil {
		return nil // already invalid, treat as success
	}
	s.redis.Del(ctx, fmt.Sprintf("rt:%s:%s", claims.Subject, claims.ID))
	return nil
}

func (s *service) Me(ctx context.Context, userID string) (*Entity, error) {
	entity, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("auth.service.Me: %w", err)
	}
	return entity, nil
}

func (s *service) SetKeys(ctx context.Context, userID string, req SetKeysRequest) (*Entity, error) {
	var codes []any
	if err := json.Unmarshal([]byte(req.RecoveryCodesData), &codes); err != nil {
		return nil, fmt.Errorf("auth.service.SetKeys: %w", apperr.ErrInvalidInput)
	}

	entity, err := s.repo.SetKeys(ctx, SetKeysParams{
		ID:                  userID,
		PublicKey:           req.PublicKey,
		EncryptedPrivateKey: req.EncryptedPrivateKey,
		Salt:                req.Salt,
		RecoveryCodesData:   req.RecoveryCodesData,
	})
	if err != nil {
		return nil, fmt.Errorf("auth.service.SetKeys: %w", err)
	}
	return entity, nil
}

func (s *service) issueTokens(ctx context.Context, userID string) (*TokenPair, error) {
	jti := uuid.New().String()

	accessToken, err := jwtutil.GenerateAccessToken(userID, s.cfg.AccessSecret, s.cfg.AccessTTL)
	if err != nil {
		return nil, fmt.Errorf("auth.service.issueTokens: %w", err)
	}

	refreshToken, err := jwtutil.GenerateRefreshToken(userID, jti, s.cfg.RefreshSecret, s.cfg.RefreshTTL)
	if err != nil {
		return nil, fmt.Errorf("auth.service.issueTokens: %w", err)
	}

	key := fmt.Sprintf("rt:%s:%s", userID, jti)
	if err := s.redis.Set(ctx, key, "1", s.cfg.RefreshTTL).Err(); err != nil {
		return nil, fmt.Errorf("auth.service.issueTokens: redis: %w", err)
	}

	return &TokenPair{AccessToken: accessToken, RefreshToken: refreshToken}, nil
}
