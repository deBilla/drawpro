// Package redis provides a Redis client factory.
package redis

import "github.com/redis/go-redis/v9"

// Connect parses a Redis URL and returns a connected client.
func Connect(url string) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opts), nil
}
