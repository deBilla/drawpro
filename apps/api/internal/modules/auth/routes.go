package auth

import (
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts all auth endpoints onto rg.
// authMW is the JWT Auth() middleware — applied only to protected routes.
// rateMW is applied to public endpoints to prevent brute-force.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, authMW gin.HandlerFunc, rateMW gin.HandlerFunc) {
	g := rg.Group("/auth")
	g.POST("/register", rateMW, h.Register)
	g.POST("/login", rateMW, h.Login)
	g.POST("/refresh", rateMW, h.Refresh)
	g.POST("/logout", authMW, h.Logout)
	g.GET("/me", authMW, h.Me)
	g.PUT("/keys", authMW, h.SetKeys)
}
