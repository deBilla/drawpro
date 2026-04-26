package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func setCookie(c *gin.Context, name, value string, maxAge int, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    value,
		MaxAge:   maxAge,
		Path:     "/",
		Secure:   secure,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

// Handler exposes HTTP endpoints for the auth domain.
type Handler struct {
	service       Service
	refreshSecret string
	accessTTL     int // seconds
	refreshTTL    int // seconds
	secure        bool
}

// NewHandler constructs a Handler.
func NewHandler(service Service, refreshSecret string, accessTTL, refreshTTL int, frontendURL string) *Handler {
	return &Handler{
		service:       service,
		refreshSecret: refreshSecret,
		accessTTL:     accessTTL,
		refreshTTL:    refreshTTL,
		secure:        strings.HasPrefix(frontendURL, "https"),
	}
}

// Register handles POST /auth/register
func (h *Handler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		_ = c.Error(err)
		return
	}
	entity, pair, err := h.service.Register(c.Request.Context(), req)
	if err != nil {
		_ = c.Error(err)
		return
	}
	h.setAuthCookies(c, pair)
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": gin.H{"user": entity.ToView()}})
}

// Login handles POST /auth/login
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		_ = c.Error(err)
		return
	}
	entity, pair, err := h.service.Login(c.Request.Context(), req)
	if err != nil {
		_ = c.Error(err)
		return
	}
	h.setAuthCookies(c, pair)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"user": entity.ToView()}})
}

// Refresh handles POST /auth/refresh
func (h *Handler) Refresh(c *gin.Context) {
	refreshToken, _ := c.Cookie("refreshToken")
	if refreshToken == "" {
		var body struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = c.ShouldBindJSON(&body)
		refreshToken = body.RefreshToken
	}
	if refreshToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": gin.H{"code": "UNAUTHORIZED", "message": "missing refresh token"}})
		return
	}

	pair, err := h.service.Refresh(c.Request.Context(), refreshToken)
	if err != nil {
		_ = c.Error(err)
		return
	}
	h.setAuthCookies(c, pair)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "ok"}})
}

// Logout handles POST /auth/logout
func (h *Handler) Logout(c *gin.Context) {
	refreshToken, _ := c.Cookie("refreshToken")
	_ = h.service.Logout(c.Request.Context(), refreshToken)
	h.clearAuthCookies(c)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Logged out"}})
}

// Me handles GET /auth/me
func (h *Handler) Me(c *gin.Context) {
	userID := c.GetString("userID")
	entity, err := h.service.Me(c.Request.Context(), userID)
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"user": entity.ToView()}})
}

// SetKeys handles PUT /auth/keys
func (h *Handler) SetKeys(c *gin.Context) {
	var req SetKeysRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		_ = c.Error(err)
		return
	}
	userID := c.GetString("userID")
	entity, err := h.service.SetKeys(c.Request.Context(), userID, req)
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entity.ToView()})
}

func (h *Handler) setAuthCookies(c *gin.Context, pair *TokenPair) {
	setCookie(c, "accessToken", pair.AccessToken, h.accessTTL, h.secure)
	setCookie(c, "refreshToken", pair.RefreshToken, h.refreshTTL, h.secure)
}

func (h *Handler) clearAuthCookies(c *gin.Context) {
	setCookie(c, "accessToken", "", -1, h.secure)
	setCookie(c, "refreshToken", "", -1, h.secure)
}
