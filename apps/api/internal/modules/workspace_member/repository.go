package workspace_member

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperr "github.com/deBilla/drawpro-api/internal/core/errors"
)

// Repository defines data-access for workspace membership.
type Repository interface {
	Create(ctx context.Context, workspaceID, userID string, role Role) (*Entity, error)
	Get(ctx context.Context, workspaceID, userID string) (*Entity, error)
}

type repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository backed by pool.
func NewRepository(pool *pgxpool.Pool) Repository {
	return &repository{pool: pool}
}

func (r *repository) Create(ctx context.Context, workspaceID, userID string, role Role) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`INSERT INTO "WorkspaceMember" ("workspaceId", "userId", role)
		 VALUES ($1, $2, $3)
		 RETURNING "workspaceId", "userId", role, "joinedAt"`,
		workspaceID, userID, string(role),
	)
	e, err := scanEntity(row)
	if err != nil {
		return nil, fmt.Errorf("workspace_member.repository.Create: %w", err)
	}
	return e, nil
}

func (r *repository) Get(ctx context.Context, workspaceID, userID string) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT "workspaceId", "userId", role, "joinedAt"
		 FROM "WorkspaceMember"
		 WHERE "workspaceId" = $1 AND "userId" = $2`,
		workspaceID, userID,
	)
	e, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("workspace_member.repository.Get: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("workspace_member.repository.Get: %w", err)
	}
	return e, nil
}

type scanner interface{ Scan(dest ...any) error }

func scanEntity(s scanner) (*Entity, error) {
	var e Entity
	var role string
	err := s.Scan(&e.WorkspaceID, &e.UserID, &role, &e.JoinedAt)
	e.Role = Role(role)
	return &e, err
}
