// Package workspace implements the Workspace domain module.
package workspace

import "time"

// SheetSummary is a lightweight sheet for workspace detail responses.
type SheetSummary struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	IsEncrypted   bool    `json:"is_encrypted"`
	EncryptedData *string `json:"encrypted_data,omitempty"`
	Version       int32   `json:"version"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

// WorkspaceDetail is returned by GetByID — includes sheets and role.
type WorkspaceDetail struct {
	Entity *Entity
	Sheets []SheetSummary
	Role   string
}

// DetailView is the full workspace response shape matching the TypeScript API.
type DetailView struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	EncryptedName *string        `json:"encrypted_name,omitempty"`
	OwnerID       string         `json:"owner_id"`
	Role          string         `json:"role"`
	Sheets        []SheetSummary `json:"sheets"`
	CreatedAt     string         `json:"created_at"`
	UpdatedAt     string         `json:"updated_at"`
}

func (d *WorkspaceDetail) ToDetailView() DetailView {
	sheets := d.Sheets
	if sheets == nil {
		sheets = []SheetSummary{}
	}
	return DetailView{
		ID:            d.Entity.ID,
		Name:          d.Entity.Name,
		EncryptedName: d.Entity.EncryptedName,
		OwnerID:       d.Entity.OwnerID,
		Role:          d.Role,
		Sheets:        sheets,
		CreatedAt:     d.Entity.CreatedAt.Format(time.RFC3339),
		UpdatedAt:     d.Entity.UpdatedAt.Format(time.RFC3339),
	}
}

// Entity is the domain representation of a Workspace.
type Entity struct {
	ID            string
	Name          string
	EncryptedName *string
	OwnerID       string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// View is the public API representation of a Workspace.
type View struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	EncryptedName *string `json:"encrypted_name,omitempty"`
	OwnerID       string  `json:"owner_id"`
	Role          string  `json:"role,omitempty"`
	SheetsCount   int     `json:"sheets_count,omitempty"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

func (e *Entity) ToView() View {
	return View{
		ID:            e.ID,
		Name:          e.Name,
		EncryptedName: e.EncryptedName,
		OwnerID:       e.OwnerID,
		CreatedAt:     e.CreatedAt.Format(time.RFC3339),
		UpdatedAt:     e.UpdatedAt.Format(time.RFC3339),
	}
}

// WorkspaceWithRole pairs an entity with membership role and sheet count.
type WorkspaceWithRole struct {
	Entity      *Entity
	Role        string
	SheetsCount int
}

func (w *WorkspaceWithRole) ToView() View {
	v := w.Entity.ToView()
	v.Role = w.Role
	v.SheetsCount = w.SheetsCount
	return v
}
