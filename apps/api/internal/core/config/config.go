// Package config loads application configuration from the environment.
package config

import "github.com/caarlos0/env/v11"

// Config holds all runtime configuration for api-go.
type Config struct {
	Port             int    `env:"PORT"               envDefault:"3001"`
	DatabaseURL      string `env:"DATABASE_URL"        required:"true"`
	RedisURL         string `env:"REDIS_URL"           required:"true"`
	JWTAccessSecret  string `env:"JWT_ACCESS_SECRET"   required:"true"`
	JWTRefreshSecret string `env:"JWT_REFRESH_SECRET"  required:"true"`
	JWTAccessTTL     int    `env:"JWT_ACCESS_TTL"      envDefault:"900"`    // seconds
	JWTRefreshTTL    int    `env:"JWT_REFRESH_TTL"     envDefault:"604800"` // seconds
	FrontendURL      string `env:"FRONTEND_URL"        envDefault:"http://localhost:3000"`
	MinioEndpoint    string `env:"MINIO_ENDPOINT"      envDefault:"localhost"`
	MinioPort        int    `env:"MINIO_PORT"          envDefault:"9000"`
	MinioAccessKey   string `env:"MINIO_ACCESS_KEY"    envDefault:"minioadmin"`
	MinioSecretKey   string `env:"MINIO_SECRET_KEY"    envDefault:"minioadmin"`
	MinioBucket      string `env:"MINIO_BUCKET"        envDefault:"drawpro"`
}

// Load parses configuration from environment variables.
func Load() (*Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
