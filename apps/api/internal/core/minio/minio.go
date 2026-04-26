// Package minio provides a MinIO client factory.
package minio

import (
	"context"
	"fmt"
	"log"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Connect creates a MinIO client.
func Connect(endpoint string, port int, accessKey, secretKey string, useSSL bool) (*minio.Client, error) {
	return minio.New(fmt.Sprintf("%s:%d", endpoint, port), &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
}

// EnsureBucket creates bucket if it doesn't exist.
func EnsureBucket(ctx context.Context, client *minio.Client, bucket string) {
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil || exists {
		return
	}
	if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: "us-east-1"}); err != nil {
		log.Printf("minio: failed to create bucket %s: %v", bucket, err)
	}
}
