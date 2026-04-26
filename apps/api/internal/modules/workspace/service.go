package workspace

import (
	"context"
	"fmt"

	apperr "github.com/deBilla/drawpro-api/internal/core/errors"
	wm "github.com/deBilla/drawpro-api/internal/modules/workspace_member"
)

// Service defines business operations for the Workspace domain.
type Service interface {
	Create(ctx context.Context, userID string, req CreateRequest) (*WorkspaceWithRole, error)
	GetByID(ctx context.Context, userID, workspaceID string) (*WorkspaceDetail, error)
	List(ctx context.Context, userID string) ([]*WorkspaceWithRole, error)
	Update(ctx context.Context, userID, workspaceID string, req UpdateRequest) (*Entity, error)
	Delete(ctx context.Context, userID, workspaceID string) error
}

type service struct {
	repo   Repository
	members wm.Repository
}

// NewService constructs a Service.
func NewService(repo Repository, members wm.Repository) Service {
	return &service{repo: repo, members: members}
}

func (s *service) Create(ctx context.Context, userID string, req CreateRequest) (*WorkspaceWithRole, error) {
	entity, err := s.repo.Create(ctx, req.ToCreateParams(userID))
	if err != nil {
		return nil, fmt.Errorf("workspace.service.Create: %w", err)
	}

	_, err = s.members.Create(ctx, entity.ID, userID, wm.RoleOwner)
	if err != nil {
		return nil, fmt.Errorf("workspace.service.Create: add member: %w", err)
	}

	return &WorkspaceWithRole{Entity: entity, Role: string(wm.RoleOwner)}, nil
}

func (s *service) GetByID(ctx context.Context, userID, workspaceID string) (*WorkspaceDetail, error) {
	member, err := s.members.Get(ctx, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("workspace.service.GetByID: %w", apperr.ErrForbidden)
	}

	detail, err := s.repo.GetByIDWithSheets(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("workspace.service.GetByID: %w", err)
	}
	detail.Role = string(member.Role)
	return detail, nil
}

func (s *service) List(ctx context.Context, userID string) ([]*WorkspaceWithRole, error) {
	results, err := s.repo.ListByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("workspace.service.List: %w", err)
	}
	return results, nil
}

func (s *service) Update(ctx context.Context, userID, workspaceID string, req UpdateRequest) (*Entity, error) {
	member, err := s.members.Get(ctx, workspaceID, userID)
	if err != nil || member.Role != wm.RoleOwner {
		return nil, fmt.Errorf("workspace.service.Update: %w", apperr.ErrForbidden)
	}

	entity, err := s.repo.Update(ctx, req.ToUpdateParams(workspaceID))
	if err != nil {
		return nil, fmt.Errorf("workspace.service.Update: %w", err)
	}
	return entity, nil
}

func (s *service) Delete(ctx context.Context, userID, workspaceID string) error {
	member, err := s.members.Get(ctx, workspaceID, userID)
	if err != nil || member.Role != wm.RoleOwner {
		return fmt.Errorf("workspace.service.Delete: %w", apperr.ErrForbidden)
	}

	if err := s.repo.Delete(ctx, workspaceID); err != nil {
		return fmt.Errorf("workspace.service.Delete: %w", err)
	}
	return nil
}
