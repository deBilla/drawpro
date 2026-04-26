package middleware

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// RateLimit returns a global (not per-IP) rate limiter middleware.
// 20 requests per 15 minutes matches the TypeScript API's auth rate limit.
func RateLimit() gin.HandlerFunc {
	// 20 requests per 15 minutes = 1 token every 45 seconds, burst of 20
	limiter := rate.NewLimiter(rate.Every(15*time.Minute/20), 20)
	return func(c *gin.Context) {
		if !limiter.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   gin.H{"code": "RATE_LIMITED", "message": "Too many attempts, please try again later"},
			})
			return
		}
		c.Next()
	}
}
