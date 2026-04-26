package workspace

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes HTTP endpoints for the Workspace domain.
type Handler struct {
	service Service
}

// NewHandler constructs a Handler.
func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

// Create handles POST /workspaces
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		_ = c.Error(err)
		return
	}
	userID := c.GetString("userID")
	wwr, err := h.service.Create(c.Request.Context(), userID, req)
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": wwr.ToView()})
}

// GetByID handles GET /workspaces/:id
func (h *Handler) GetByID(c *gin.Context) {
	userID := c.GetString("userID")
	detail, err := h.service.GetByID(c.Request.Context(), userID, c.Param("workspaceId"))
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": detail.ToDetailView()})
}

// List handles GET /workspaces
func (h *Handler) List(c *gin.Context) {
	userID := c.GetString("userID")
	results, err := h.service.List(c.Request.Context(), userID)
	if err != nil {
		_ = c.Error(err)
		return
	}
	views := make([]View, len(results))
	for i, w := range results {
		views[i] = w.ToView()
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": views})
}

// Update handles PATCH /workspaces/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		_ = c.Error(err)
		return
	}
	userID := c.GetString("userID")
	entity, err := h.service.Update(c.Request.Context(), userID, c.Param("workspaceId"), req)
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entity.ToView()})
}

// Delete handles DELETE /workspaces/:id
func (h *Handler) Delete(c *gin.Context) {
	userID := c.GetString("userID")
	if err := h.service.Delete(c.Request.Context(), userID, c.Param("workspaceId")); err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Workspace deleted"}})
}
