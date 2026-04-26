// Package middleware provides Gin middleware for api-go.
package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	jwtutil "github.com/deBilla/drawpro-api/internal/core/jwt"
)

var jwtAccessSecret string

// SetJWTSecret configures the secret used by the Auth middleware.
func SetJWTSecret(secret string) { jwtAccessSecret = secret }

// Auth validates a JWT access token from the accessToken cookie or
// Authorization: Bearer header, and injects userID into the Gin context.
func Auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr, _ := c.Cookie("accessToken")
		if tokenStr == "" {
			if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
				tokenStr = strings.TrimPrefix(h, "Bearer ")
			}
		}
		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   gin.H{"code": "UNAUTHORIZED", "message": "missing token"},
			})
			return
		}

		claims, err := jwtutil.ParseToken(tokenStr, jwtAccessSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   gin.H{"code": "UNAUTHORIZED", "message": "invalid or expired token"},
			})
			return
		}

		c.Set("userID", claims.Subject)
		c.Next()
	}
}
