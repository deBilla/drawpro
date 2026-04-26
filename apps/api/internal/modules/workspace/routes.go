package workspace

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the Workspace CRUD routes onto rg.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, middlewares ...gin.HandlerFunc) {
	g := rg.Group("/workspaces", middlewares...)
	g.POST("", h.Create)
	g.GET("", h.List)
	g.GET("/:workspaceId", h.GetByID)
	g.PATCH("/:workspaceId", h.Update)
	g.DELETE("/:workspaceId", h.Delete)
}
