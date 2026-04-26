package sheet

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes HTTP endpoints for the Sheet domain.
// All routes are nested under /workspaces/:workspaceId/sheets.
type Handler struct {
	service Service
}

// NewHandler constructs a Handler.
func NewHandler(service Service) *Handler {
	return &Handler{service: service}
}

// Create handles POST /workspaces/:workspaceId/sheets
func (h *Handler) Create(c *gin.Context) {
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		_ = c.Error(err)
		return
	}
	userID := c.GetString("userID")
	workspaceID := c.Param("workspaceId")

	entity, err := h.service.Create(c.Request.Context(), userID, workspaceID, req)
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": entity.ToView()})
}

// GetByID handles GET /workspaces/:workspaceId/sheets/:id
func (h *Handler) GetByID(c *gin.Context) {
	userID := c.GetString("userID")
	entity, err := h.service.GetByID(c.Request.Context(), userID, c.Param("workspaceId"), c.Param("id"))
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entity.ToView()})
}

// List handles GET /workspaces/:workspaceId/sheets
func (h *Handler) List(c *gin.Context) {
	userID := c.GetString("userID")
	entities, err := h.service.List(c.Request.Context(), userID, c.Param("workspaceId"))
	if err != nil {
		_ = c.Error(err)
		return
	}
	views := make([]SummaryView, len(entities))
	for i, e := range entities {
		views[i] = e.ToSummaryView()
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": views})
}

// Update handles PUT /workspaces/:workspaceId/sheets/:id
func (h *Handler) Update(c *gin.Context) {
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		_ = c.Error(err)
		return
	}
	userID := c.GetString("userID")
	entity, err := h.service.Update(c.Request.Context(), userID, c.Param("workspaceId"), c.Param("id"), req)
	if err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entity.ToView()})
}

// Delete handles DELETE /workspaces/:workspaceId/sheets/:id
func (h *Handler) Delete(c *gin.Context) {
	userID := c.GetString("userID")
	if err := h.service.Delete(c.Request.Context(), userID, c.Param("workspaceId"), c.Param("id")); err != nil {
		_ = c.Error(err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"message": "Sheet deleted"}})
}
