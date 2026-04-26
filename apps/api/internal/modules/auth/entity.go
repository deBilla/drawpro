// Package auth implements user authentication and key management.
package auth

import "time"

// Entity is the domain model for a registered user.
type Entity struct {
	ID                  string
	Email               string
	PasswordHash        string
	Name                *string
	PublicKey           *string
	EncryptedPrivateKey *string
	Salt                *string
	RecoveryCodesData   *string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// View is the public API representation (password hash omitted).
type View struct {
	ID                  string  `json:"id"`
	Email               string  `json:"email"`
	Name                *string `json:"name"`
	PublicKey           *string `json:"public_key"`
	EncryptedPrivateKey *string `json:"encrypted_private_key"`
	Salt                *string `json:"salt"`
	RecoveryCodesData   *string `json:"recovery_codes_data"`
	CreatedAt           string  `json:"created_at"`
}

func (e *Entity) ToView() View {
	return View{
		ID:                  e.ID,
		Email:               e.Email,
		Name:                e.Name,
		PublicKey:           e.PublicKey,
		EncryptedPrivateKey: e.EncryptedPrivateKey,
		Salt:                e.Salt,
		RecoveryCodesData:   e.RecoveryCodesData,
		CreatedAt:           e.CreatedAt.Format(time.RFC3339),
	}
}
