// Package workspace_member manages workspace membership (join table).
package workspace_member

import "time"

// Role is the membership role within a workspace.
type Role string

const (
	RoleOwner  Role = "owner"
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

// Entity represents a workspace membership record.
type Entity struct {
	WorkspaceID string
	UserID      string
	Role        Role
	JoinedAt    time.Time
}
