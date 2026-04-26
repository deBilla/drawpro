package workspace

// CreateRequest holds fields accepted when creating a new workspace.
// OwnerID is injected from the JWT — not accepted from the client.
type CreateRequest struct {
	Name          string  `json:"name"           binding:"required,min=1,max=100"`
	EncryptedName *string `json:"encrypted_name"`
}

// UpdateRequest holds fields accepted when updating an existing workspace.
type UpdateRequest struct {
	Name          *string `json:"name"`
	EncryptedName *string `json:"encrypted_name"`
}

// CreateParams maps a CreateRequest to repository-level parameters.
type CreateParams struct {
	Name          string
	EncryptedName *string
	OwnerID       string
}

// UpdateParams maps an UpdateRequest to repository-level parameters.
type UpdateParams struct {
	ID            string
	Name          *string
	EncryptedName *string
}

func (r *CreateRequest) ToCreateParams(ownerID string) CreateParams {
	p := CreateParams{
		Name:    r.Name,
		OwnerID: ownerID,
	}
	if r.EncryptedName != nil {
		enc := r.EncryptedName
		p.EncryptedName = enc
		placeholder := "[encrypted]"
		p.Name = placeholder
	}
	return p
}

func (r *UpdateRequest) ToUpdateParams(id string) UpdateParams {
	return UpdateParams{
		ID:            id,
		Name:          r.Name,
		EncryptedName: r.EncryptedName,
	}
}
