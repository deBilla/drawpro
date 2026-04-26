package sheet

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts sheet routes nested under /workspaces/:workspaceId/sheets.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, middlewares ...gin.HandlerFunc) {
	g := rg.Group("/workspaces/:workspaceId/sheets", middlewares...)
	g.POST("", h.Create)
	g.GET("", h.List)
	g.GET("/:id", h.GetByID)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
}
