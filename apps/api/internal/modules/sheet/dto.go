package sheet

import "encoding/json"

// CreateRequest is the body for POST /workspaces/:wid/sheets.
// WorkspaceID is injected from the URL param, not the body.
type CreateRequest struct {
	Name string `json:"name" binding:"required,min=1,max=200"`
}

// UpdateRequest is the body for PUT /workspaces/:wid/sheets/:id.
type UpdateRequest struct {
	Name     *string         `json:"name"`
	Elements json.RawMessage `json:"elements"`
	AppState json.RawMessage `json:"app_state"`
}

// CreateParams holds repository-level parameters for creating a sheet.
type CreateParams struct {
	WorkspaceID string
	Name        string
}

// UpdateParams holds repository-level parameters for updating a sheet.
type UpdateParams struct {
	ID            string
	Name          *string
	Elements      json.RawMessage
	AppState      json.RawMessage
	EncryptedData *string
}
