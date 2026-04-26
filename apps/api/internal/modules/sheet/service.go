package sheet

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/deBilla/drawpro-api/internal/core/crypto"
	apperr "github.com/deBilla/drawpro-api/internal/core/errors"
	authrepo "github.com/deBilla/drawpro-api/internal/modules/auth"
	wm "github.com/deBilla/drawpro-api/internal/modules/workspace_member"
)

// Service defines business operations for the Sheet domain.
type Service interface {
	Create(ctx context.Context, userID, workspaceID string, req CreateRequest) (*Entity, error)
	GetByID(ctx context.Context, userID, workspaceID, sheetID string) (*Entity, error)
	List(ctx context.Context, userID, workspaceID string) ([]*Entity, error)
	Update(ctx context.Context, userID, workspaceID, sheetID string, req UpdateRequest) (*Entity, error)
	Delete(ctx context.Context, userID, workspaceID, sheetID string) error
}

type service struct {
	repo    Repository
	users   authrepo.Repository
	members wm.Repository
}

// NewService constructs a Service.
func NewService(repo Repository, users authrepo.Repository, members wm.Repository) Service {
	return &service{repo: repo, users: users, members: members}
}

func (s *service) checkMembership(ctx context.Context, workspaceID, userID string) (*wm.Entity, error) {
	m, err := s.members.Get(ctx, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("%w", apperr.ErrForbidden)
	}
	return m, nil
}

func (s *service) Create(ctx context.Context, userID, workspaceID string, req CreateRequest) (*Entity, error) {
	m, err := s.checkMembership(ctx, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("sheet.service.Create: %w", err)
	}
	if m.Role == wm.RoleViewer {
		return nil, fmt.Errorf("sheet.service.Create: %w", apperr.ErrForbidden)
	}

	entity, err := s.repo.Create(ctx, CreateParams{WorkspaceID: workspaceID, Name: req.Name})
	if err != nil {
		return nil, fmt.Errorf("sheet.service.Create: %w", err)
	}
	return entity, nil
}

func (s *service) GetByID(ctx context.Context, userID, workspaceID, sheetID string) (*Entity, error) {
	if _, err := s.checkMembership(ctx, workspaceID, userID); err != nil {
		return nil, fmt.Errorf("sheet.service.GetByID: %w", err)
	}

	entity, err := s.repo.GetByID(ctx, sheetID)
	if err != nil {
		return nil, fmt.Errorf("sheet.service.GetByID: %w", err)
	}
	if entity.WorkspaceID != workspaceID {
		return nil, fmt.Errorf("sheet.service.GetByID: %w", apperr.ErrNotFound)
	}
	return entity, nil
}

func (s *service) List(ctx context.Context, userID, workspaceID string) ([]*Entity, error) {
	if _, err := s.checkMembership(ctx, workspaceID, userID); err != nil {
		return nil, fmt.Errorf("sheet.service.List: %w", err)
	}

	entities, err := s.repo.ListByWorkspaceID(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("sheet.service.List: %w", err)
	}
	return entities, nil
}

func (s *service) Update(ctx context.Context, userID, workspaceID, sheetID string, req UpdateRequest) (*Entity, error) {
	m, err := s.checkMembership(ctx, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("sheet.service.Update: %w", err)
	}
	if m.Role == wm.RoleViewer {
		return nil, fmt.Errorf("sheet.service.Update: %w", apperr.ErrForbidden)
	}

	existing, err := s.repo.GetByID(ctx, sheetID)
	if err != nil {
		return nil, fmt.Errorf("sheet.service.Update: %w", err)
	}
	if existing.WorkspaceID != workspaceID {
		return nil, fmt.Errorf("sheet.service.Update: %w", apperr.ErrNotFound)
	}

	params := UpdateParams{ID: sheetID, Name: req.Name}

	user, userErr := s.users.GetByID(ctx, userID)
	if userErr == nil && user.PublicKey != nil {
		params, err = s.buildEncryptedUpdate(sheetID, req, existing, user.PublicKey)
		if err != nil {
			return nil, fmt.Errorf("sheet.service.Update: encrypt: %w", err)
		}
	} else {
		params.Elements = mergeJSON(existing.Elements, req.Elements)
		params.AppState = mergeJSON(existing.AppState, req.AppState)
	}

	entity, err := s.repo.Update(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("sheet.service.Update: %w", err)
	}
	return entity, nil
}

func (s *service) Delete(ctx context.Context, userID, workspaceID, sheetID string) error {
	m, err := s.checkMembership(ctx, workspaceID, userID)
	if err != nil {
		return fmt.Errorf("sheet.service.Delete: %w", err)
	}
	if m.Role == wm.RoleViewer {
		return fmt.Errorf("sheet.service.Delete: %w", apperr.ErrForbidden)
	}

	existing, err := s.repo.GetByID(ctx, sheetID)
	if err != nil {
		return fmt.Errorf("sheet.service.Delete: %w", err)
	}
	if existing.WorkspaceID != workspaceID {
		return fmt.Errorf("sheet.service.Delete: %w", apperr.ErrNotFound)
	}

	if err := s.repo.Delete(ctx, sheetID); err != nil {
		return fmt.Errorf("sheet.service.Delete: %w", err)
	}
	return nil
}

func (s *service) buildEncryptedUpdate(sheetID string, req UpdateRequest, existing *Entity, publicKey *string) (UpdateParams, error) {
	name := existing.Name
	if req.Name != nil {
		name = *req.Name
	}

	payload := map[string]any{
		"name":     name,
		"elements": json.RawMessage(mergeJSON(existing.Elements, req.Elements)),
		"appState": json.RawMessage(mergeJSON(existing.AppState, req.AppState)),
	}
	plaintextBytes, err := json.Marshal(payload)
	if err != nil {
		return UpdateParams{}, fmt.Errorf("marshal payload: %w", err)
	}

	encryptedData, err := crypto.EncryptForUser(plaintextBytes, *publicKey)
	if err != nil {
		return UpdateParams{}, err
	}

	placeholder := "[encrypted]"
	return UpdateParams{
		ID:            sheetID,
		Name:          &placeholder,
		EncryptedData: &encryptedData,
	}, nil
}

func mergeJSON(stored, incoming json.RawMessage) json.RawMessage {
	if len(incoming) > 0 {
		return incoming
	}
	return stored
}
