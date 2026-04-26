// Package sheet implements the Sheet domain module.
package sheet

import (
	"encoding/json"
	"time"
)

// Entity is the domain model for a Sheet.
type Entity struct {
	ID            string
	WorkspaceID   string
	Name          string
	Elements      json.RawMessage
	AppState      json.RawMessage
	EncryptedData *string
	Version       int32
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// View is the public API representation of a Sheet.
type View struct {
	ID            string          `json:"id"`
	WorkspaceID   string          `json:"workspace_id"`
	Name          string          `json:"name"`
	IsEncrypted   bool            `json:"is_encrypted"`
	Elements      json.RawMessage `json:"elements,omitempty"`
	AppState      json.RawMessage `json:"app_state,omitempty"`
	EncryptedData *string         `json:"encrypted_data,omitempty"`
	Version       int32           `json:"version"`
	CreatedAt     string          `json:"created_at"`
	UpdatedAt     string          `json:"updated_at"`
}

// ToView converts the entity to its API representation.
func (e *Entity) ToView() View {
	v := View{
		ID:            e.ID,
		WorkspaceID:   e.WorkspaceID,
		Name:          e.Name,
		IsEncrypted:   e.EncryptedData != nil,
		Elements:      e.Elements,
		AppState:      e.AppState,
		EncryptedData: e.EncryptedData,
		Version:       e.Version,
		CreatedAt:     e.CreatedAt.Format(time.RFC3339),
		UpdatedAt:     e.UpdatedAt.Format(time.RFC3339),
	}
	return v
}

// SummaryView omits large fields for list responses.
type SummaryView struct {
	ID            string  `json:"id"`
	WorkspaceID   string  `json:"workspace_id"`
	Name          string  `json:"name"`
	IsEncrypted   bool    `json:"is_encrypted"`
	EncryptedData *string `json:"encrypted_data,omitempty"`
	Version       int32   `json:"version"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

func (e *Entity) ToSummaryView() SummaryView {
	return SummaryView{
		ID:            e.ID,
		WorkspaceID:   e.WorkspaceID,
		Name:          e.Name,
		IsEncrypted:   e.EncryptedData != nil,
		EncryptedData: e.EncryptedData,
		Version:       e.Version,
		CreatedAt:     e.CreatedAt.Format(time.RFC3339),
		UpdatedAt:     e.UpdatedAt.Format(time.RFC3339),
	}
}
