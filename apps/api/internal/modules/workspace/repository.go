package workspace

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apperr "github.com/deBilla/drawpro-api/internal/core/errors"
)

// Repository defines the data-access contract for the Workspace domain.
type Repository interface {
	Create(ctx context.Context, p CreateParams) (*Entity, error)
	GetByID(ctx context.Context, id string) (*Entity, error)
	GetByIDWithSheets(ctx context.Context, id string) (*WorkspaceDetail, error)
	ListByUserID(ctx context.Context, userID string) ([]*WorkspaceWithRole, error)
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

func (r *repository) Create(ctx context.Context, p CreateParams) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`INSERT INTO "Workspace" (name, "encryptedName", "ownerId")
		 VALUES ($1, $2, $3)
		 RETURNING id, name, "encryptedName", "ownerId", "createdAt", "updatedAt"`,
		p.Name, p.EncryptedName, p.OwnerID,
	)
	entity, err := scanEntity(row)
	if err != nil {
		return nil, fmt.Errorf("workspace.repository.Create: %w", err)
	}
	return entity, nil
}

func (r *repository) GetByID(ctx context.Context, id string) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT id, name, "encryptedName", "ownerId", "createdAt", "updatedAt"
		 FROM "Workspace" WHERE id = $1`, id,
	)
	entity, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("workspace.repository.GetByID: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("workspace.repository.GetByID: %w", err)
	}
	return entity, nil
}

// ListByUserID returns all workspaces the user is a member of, with their role and sheet count.
func (r *repository) ListByUserID(ctx context.Context, userID string) ([]*WorkspaceWithRole, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT w.id, w.name, w."encryptedName", w."ownerId", w."createdAt", w."updatedAt",
		        wm.role,
		        COUNT(s.id) AS sheets_count
		 FROM "Workspace" w
		 JOIN "WorkspaceMember" wm ON wm."workspaceId" = w.id AND wm."userId" = $1
		 LEFT JOIN "Sheet" s ON s."workspaceId" = w.id
		 GROUP BY w.id, w.name, w."encryptedName", w."ownerId", w."createdAt", w."updatedAt", wm.role
		 ORDER BY w."updatedAt" DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("workspace.repository.ListByUserID: %w", err)
	}
	defer rows.Close()

	var results []*WorkspaceWithRole
	for rows.Next() {
		var wwr WorkspaceWithRole
		wwr.Entity = &Entity{}
		err := rows.Scan(
			&wwr.Entity.ID, &wwr.Entity.Name, &wwr.Entity.EncryptedName, &wwr.Entity.OwnerID,
			&wwr.Entity.CreatedAt, &wwr.Entity.UpdatedAt,
			&wwr.Role, &wwr.SheetsCount,
		)
		if err != nil {
			return nil, fmt.Errorf("workspace.repository.ListByUserID scan: %w", err)
		}
		results = append(results, &wwr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("workspace.repository.ListByUserID rows: %w", err)
	}
	return results, nil
}

func (r *repository) GetByIDWithSheets(ctx context.Context, id string) (*WorkspaceDetail, error) {
	entity, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	rows, err := r.pool.Query(ctx,
		`SELECT id, name, "encryptedData", version, "createdAt", "updatedAt"
		 FROM "Sheet" WHERE "workspaceId" = $1 ORDER BY "updatedAt" DESC`,
		id,
	)
	if err != nil {
		return nil, fmt.Errorf("workspace.repository.GetByIDWithSheets sheets: %w", err)
	}
	defer rows.Close()

	var sheets []SheetSummary
	for rows.Next() {
		var s SheetSummary
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&s.ID, &s.Name, &s.EncryptedData, &s.Version, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("workspace.repository.GetByIDWithSheets scan: %w", err)
		}
		s.IsEncrypted = s.EncryptedData != nil
		s.CreatedAt = createdAt.Format(time.RFC3339)
		s.UpdatedAt = updatedAt.Format(time.RFC3339)
		sheets = append(sheets, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("workspace.repository.GetByIDWithSheets rows: %w", err)
	}

	return &WorkspaceDetail{Entity: entity, Sheets: sheets}, nil
}

func (r *repository) Update(ctx context.Context, p UpdateParams) (*Entity, error) {
	row := r.pool.QueryRow(ctx,
		`UPDATE "Workspace" SET
		  name            = COALESCE($2, name),
		  "encryptedName" = COALESCE($3, "encryptedName"),
		  "updatedAt"     = now()
		 WHERE id = $1
		 RETURNING id, name, "encryptedName", "ownerId", "createdAt", "updatedAt"`,
		p.ID, p.Name, p.EncryptedName,
	)
	entity, err := scanEntity(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("workspace.repository.Update: %w", apperr.ErrNotFound)
		}
		return nil, fmt.Errorf("workspace.repository.Update: %w", err)
	}
	return entity, nil
}

func (r *repository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM "Workspace" WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("workspace.repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("workspace.repository.Delete: %w", apperr.ErrNotFound)
	}
	return nil
}

type scanner interface{ Scan(dest ...any) error }

func scanEntity(s scanner) (*Entity, error) {
	var e Entity
	err := s.Scan(&e.ID, &e.Name, &e.EncryptedName, &e.OwnerID, &e.CreatedAt, &e.UpdatedAt)
	return &e, err
}
