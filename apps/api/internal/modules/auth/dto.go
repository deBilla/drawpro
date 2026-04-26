package auth

// RegisterRequest is the body for POST /auth/register.
type RegisterRequest struct {
	Email    string  `json:"email"    binding:"required,email"`
	Password string  `json:"password" binding:"required,min=8"`
	Name     *string `json:"name"`
}

// LoginRequest is the body for POST /auth/login.
type LoginRequest struct {
	Email    string `json:"email"    binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// SetKeysRequest is the body for PUT /auth/keys.
type SetKeysRequest struct {
	PublicKey           string `json:"public_key"            binding:"required"`
	EncryptedPrivateKey string `json:"encrypted_private_key" binding:"required"`
	Salt                string `json:"salt"                  binding:"required"`
	RecoveryCodesData   string `json:"recovery_codes_data"   binding:"required"`
}
