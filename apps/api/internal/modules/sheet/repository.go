package sheet

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperr "github.com/deBilla/drawpro-api/internal/core/errors"
)

// Repository defines the data-access contract for the Sheet domain.
type Repository interface {
	Create(ctx context.Context, p CreateParams) (*Entity, error)
	GetByID(ctx context.Context, id string) (*Entity, error)
	ListByWorkspaceID(ctx context.Context, workspaceID string) ([]*Entity, error)
	Update(ctx context.Context, p UpdateParams) (*Entity, error)
	Delete(ctx context.Context, id string) error
}

type repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository backed by pool.
func NewRepository(pool *pgxpool.Pool) Repository {
	return &repository{pool: pool}
}

const selectCols = `id, workspace_id, name, elements, app_state, encrypted_data, version, created_at, updated_at`

func (r *repository) Create(ctx context.Context, p CreateParams) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`INSERT INTO sheets (workspace_id, name)
		 VALUES ($1, $2)
		 RETURNING `+selectCols,
		p.WorkspaceID, p.Name,
	)
	e, err := scanEntity(row)
	if err != nil {
		return nil, fmt.Errorf("sheet.repository.Create: %w", err)
	}
	return e, nil
}

func (r *repository) GetByID(ctx context.Context, id string) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+selectCols+` FROM sheets WHERE id = $1`, id,
	)
	e, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("sheet.repository.GetByID: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("sheet.repository.GetByID: %w", err)
	}
	return e, nil
}

func (r *repository) ListByWorkspaceID(ctx context.Context, workspaceID string) ([]*Entity, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+selectCols+` FROM sheets WHERE workspace_id = $1 ORDER BY updated_at DESC`,
		workspaceID,
	)
	if err != nil {
		return nil, fmt.Errorf("sheet.repository.ListByWorkspaceID: %w", err)
	}
	defer rows.Close()

	var entities []*Entity
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			return nil, fmt.Errorf("sheet.repository.ListByWorkspaceID scan: %w", err)
		}
		entities = append(entities, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sheet.repository.ListByWorkspaceID rows: %w", err)
	}
	return entities, nil
}

func (r *repository) Update(ctx context.Context, p UpdateParams) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`UPDATE sheets SET
		  name           = COALESCE($2, name),
		  elements       = COALESCE($3, elements),
		  app_state      = COALESCE($4, app_state),
		  encrypted_data = COALESCE($5, encrypted_data),
		  version        = version + 1,
		  updated_at     = now()
		 WHERE id = $1
		 RETURNING `+selectCols,
		p.ID, p.Name, p.Elements, p.AppState, p.EncryptedData,
	)
	e, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("sheet.repository.Update: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("sheet.repository.Update: %w", err)
	}
	return e, nil
}

func (r *repository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM sheets WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("sheet.repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("sheet.repository.Delete: %w", apperr.ErrNotFound)
	}
	return nil
}

type scanner interface{ Scan(dest ...any) error }

func scanEntity(s scanner) (*Entity, error) {
	var e Entity
	err := s.Scan(
		&e.ID, &e.WorkspaceID, &e.Name,
		&e.Elements, &e.AppState, &e.EncryptedData,
		&e.Version, &e.CreatedAt, &e.UpdatedAt,
	)
	return &e, err
}
