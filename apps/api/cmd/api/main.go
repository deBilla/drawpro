package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/deBilla/drawpro-api/internal/core/config"
	"github.com/deBilla/drawpro-api/internal/core/db"
	minioclient "github.com/deBilla/drawpro-api/internal/core/minio"
	redisclient "github.com/deBilla/drawpro-api/internal/core/redis"
	"github.com/deBilla/drawpro-api/internal/middleware"
	"github.com/deBilla/drawpro-api/internal/modules/auth"
	"github.com/deBilla/drawpro-api/internal/modules/sheet"
	"github.com/deBilla/drawpro-api/internal/modules/workspace"
	wm "github.com/deBilla/drawpro-api/internal/modules/workspace_member"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("config", zap.Error(err))
	}

	// Database
	pool, err := db.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("database", zap.Error(err))
	}
	defer pool.Close()
	logger.Info("database connected")

	// Redis
	rdb, err := redisclient.Connect(cfg.RedisURL)
	if err != nil {
		logger.Fatal("redis", zap.Error(err))
	}
	logger.Info("redis connected")

	// MinIO
	minioClient, err := minioclient.Connect(
		cfg.MinioEndpoint, cfg.MinioPort,
		cfg.MinioAccessKey, cfg.MinioSecretKey,
		strings.HasPrefix(cfg.FrontendURL, "https"),
	)
	if err != nil {
		logger.Warn("minio connect failed", zap.Error(err))
	} else {
		minioclient.EnsureBucket(context.Background(), minioClient, cfg.MinioBucket)
		logger.Info("minio ready", zap.String("bucket", cfg.MinioBucket))
	}

	// Repositories
	authRepo      := auth.NewRepository(pool)
	wmRepo        := wm.NewRepository(pool)
	workspaceRepo := workspace.NewRepository(pool)
	sheetRepo     := sheet.NewRepository(pool)

	// Services
	authSvc := auth.NewService(authRepo, rdb, auth.ServiceConfig{
		AccessSecret:  cfg.JWTAccessSecret,
		RefreshSecret: cfg.JWTRefreshSecret,
		AccessTTL:     time.Duration(cfg.JWTAccessTTL) * time.Second,
		RefreshTTL:    time.Duration(cfg.JWTRefreshTTL) * time.Second,
	})
	workspaceSvc := workspace.NewService(workspaceRepo, wmRepo)
	sheetSvc     := sheet.NewService(sheetRepo, authRepo, wmRepo)

	// Handlers
	authHandler      := auth.NewHandler(authSvc, cfg.JWTRefreshSecret, cfg.JWTAccessTTL, cfg.JWTRefreshTTL, cfg.FrontendURL)
	workspaceHandler := workspace.NewHandler(workspaceSvc)
	sheetHandler     := sheet.NewHandler(sheetSvc)

	// Configure JWT middleware secret
	middleware.SetJWTSecret(cfg.JWTAccessSecret)

	// Router
	r := gin.New()
	r.Use(middleware.Logger(logger))
	r.Use(middleware.ErrorHandler(logger))
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{cfg.FrontendURL},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "api"})
	})

	v1 := r.Group("/api/v1")

	auth.RegisterRoutes(v1, authHandler, middleware.Auth(), middleware.RateLimit())
	workspace.RegisterRoutes(v1, workspaceHandler, middleware.Auth())
	sheet.RegisterRoutes(v1, sheetHandler, middleware.Auth())

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: r,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("server started", zap.Int("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("listen", zap.Error(err))
		}
	}()

	<-ctx.Done()
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		logger.Error("shutdown", zap.Error(err))
	}
	logger.Info("server stopped")
}
