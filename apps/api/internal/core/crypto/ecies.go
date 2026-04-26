// Package crypto provides ECIES encryption matching the TypeScript frontend.
// Wire format: eph_pub(32) | iv(16) | authTag(16) | ciphertext
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha512"
	"encoding/base64"
	"fmt"
	"io"

	"golang.org/x/crypto/hkdf"
)

// EncryptForUser encrypts plaintext for the owner of userPublicKeyB64 (base64 X25519 raw key).
func EncryptForUser(plaintext []byte, userPublicKeyB64 string) (string, error) {
	pubKeyBytes, err := base64.StdEncoding.DecodeString(userPublicKeyB64)
	if err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: decode public key: %w", err)
	}

	curve := ecdh.X25519()
	userPubKey, err := curve.NewPublicKey(pubKeyBytes)
	if err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: import public key: %w", err)
	}

	ephKey, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: generate ephemeral key: %w", err)
	}

	sharedSecret, err := ephKey.ECDH(userPubKey)
	if err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: ECDH: %w", err)
	}

	hkdfR := hkdf.New(sha512.New, sharedSecret, []byte("drawpro-e2ee-salt"), []byte("drawpro-e2ee-key"))
	aesKey := make([]byte, 32)
	if _, err := io.ReadFull(hkdfR, aesKey); err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: HKDF: %w", err)
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: AES cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: GCM: %w", err)
	}

	iv := make([]byte, 16)
	if _, err := rand.Read(iv); err != nil {
		return "", fmt.Errorf("crypto.EncryptForUser: IV: %w", err)
	}

	// gcm.Seal appends authTag at the end: sealed = ciphertext || tag
	sealed := gcm.Seal(nil, iv, plaintext, []byte("drawpro-e2ee-message"))
	tagOffset := len(sealed) - gcm.Overhead()
	ct := sealed[:tagOffset]
	tag := sealed[tagOffset:]

	ephPub := ephKey.PublicKey().Bytes() // 32 bytes for X25519

	out := make([]byte, 0, 32+16+16+len(ct))
	out = append(out, ephPub...)
	out = append(out, iv...)
	out = append(out, tag...)
	out = append(out, ct...)

	return base64.StdEncoding.EncodeToString(out), nil
}
