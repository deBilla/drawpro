package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperr "github.com/deBilla/drawpro-api/internal/core/errors"
)

// CreateParams holds the fields needed to insert a new user.
type CreateParams struct {
	Email        string
	PasswordHash string
	Name         *string
}

// SetKeysParams holds the E2EE key fields to persist for a user.
type SetKeysParams struct {
	ID                  string
	PublicKey           string
	EncryptedPrivateKey string
	Salt                string
	RecoveryCodesData   string
}

// Repository defines data-access for the auth domain.
type Repository interface {
	Create(ctx context.Context, p CreateParams) (*Entity, error)
	GetByID(ctx context.Context, id string) (*Entity, error)
	GetByEmail(ctx context.Context, email string) (*Entity, error)
	SetKeys(ctx context.Context, p SetKeysParams) (*Entity, error)
}

type repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository backed by pool.
func NewRepository(pool *pgxpool.Pool) Repository {
	return &repository{pool: pool}
}

const selectCols = `id, email, password_hash, name, public_key, encrypted_private_key, salt, recovery_codes_data, created_at, updated_at`

func (r *repository) Create(ctx context.Context, p CreateParams) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, name)
		 VALUES ($1, $2, $3)
		 RETURNING `+selectCols,
		p.Email, p.PasswordHash, p.Name,
	)
	e, err := scanEntity(row)
	if err != nil {
		return nil, fmt.Errorf("auth.repository.Create: %w", err)
	}
	return e, nil
}

func (r *repository) GetByID(ctx context.Context, id string) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+selectCols+` FROM users WHERE id = $1`, id,
	)
	e, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("auth.repository.GetByID: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("auth.repository.GetByID: %w", err)
	}
	return e, nil
}

func (r *repository) GetByEmail(ctx context.Context, email string) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+selectCols+` FROM users WHERE email = $1`, email,
	)
	e, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("auth.repository.GetByEmail: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("auth.repository.GetByEmail: %w", err)
	}
	return e, nil
}

func (r *repository) SetKeys(ctx context.Context, p SetKeysParams) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`UPDATE users
		 SET public_key = $2, encrypted_private_key = $3, salt = $4, recovery_codes_data = $5, updated_at = now()
		 WHERE id = $1
		 RETURNING `+selectCols,
		p.ID, p.PublicKey, p.EncryptedPrivateKey, p.Salt, p.RecoveryCodesData,
	)
	e, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("auth.repository.SetKeys: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("auth.repository.SetKeys: %w", err)
	}
	return e, nil
}

type scanner interface{ Scan(dest ...any) error }

func scanEntity(s scanner) (*Entity, error) {
	var e Entity
	err := s.Scan(
		&e.ID, &e.Email, &e.PasswordHash, &e.Name,
		&e.PublicKey, &e.EncryptedPrivateKey, &e.Salt, &e.RecoveryCodesData,
		&e.CreatedAt, &e.UpdatedAt,
	)
	return &e, err
}
