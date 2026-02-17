package backups

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"baseful/db"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type BackupSettings struct {
	DatabaseID int    `json:"database_id"`
	Enabled    bool   `json:"enabled"`
	Provider   string `json:"provider"`
	Endpoint   string `json:"endpoint"`
	Region     string `json:"region"`
	Bucket     string `json:"bucket"`
	AccessKey  string `json:"access_key"`
	SecretKey  string `json:"secret_key"`
	PathPrefix string `json:"path_prefix"`
}

type Backup struct {
	ID         int    `json:"id"`
	DatabaseID int    `json:"database_id"`
	Filename   string `json:"filename"`
	SizeBytes  int64  `json:"size_bytes"`
	Status     string `json:"status"`
	S3URL      string `json:"s3_url"`
	Error      string `json:"error"`
	CreatedAt  string `json:"created_at"`
}

func GetBackupSettings(databaseID int) (*BackupSettings, error) {
	var s BackupSettings
	s.DatabaseID = databaseID
	err := db.DB.QueryRow(`
		SELECT enabled, provider, endpoint, region, bucket, access_key, secret_key, path_prefix
		FROM backup_settings WHERE database_id = ?
	`, databaseID).Scan(
		&s.Enabled, &s.Provider, &s.Endpoint, &s.Region, &s.Bucket, &s.AccessKey, &s.SecretKey, &s.PathPrefix,
	)
	if err == sql.ErrNoRows {
		// Return defaults
		return &BackupSettings{
			DatabaseID: databaseID,
			Enabled:    false,
			Provider:   "s3",
			Endpoint:   "",
			Region:     "us-east-1",
			PathPrefix: "/baseful/backups",
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func SaveBackupSettings(s *BackupSettings) error {
	_, err := db.DB.Exec(`
		INSERT INTO backup_settings (database_id, enabled, provider, endpoint, region, bucket, access_key, secret_key, path_prefix, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(database_id) DO UPDATE SET
			enabled=excluded.enabled,
			provider=excluded.provider,
			endpoint=excluded.endpoint,
			region=excluded.region,
			bucket=excluded.bucket,
			access_key=excluded.access_key,
			secret_key=excluded.secret_key,
			path_prefix=excluded.path_prefix,
			updated_at=CURRENT_TIMESTAMP
	`, s.DatabaseID, s.Enabled, s.Provider, s.Endpoint, s.Region, s.Bucket, s.AccessKey, s.SecretKey, s.PathPrefix)
	return err
}

func ListBackups(databaseID int) ([]Backup, error) {
	// Get Settings for signing
	settings, _ := GetBackupSettings(databaseID)
	var minioClient *minio.Client
	if settings != nil && settings.Enabled && settings.AccessKey != "" {
		useSSL := !strings.HasPrefix(settings.Endpoint, "http://")
		endpoint := strings.TrimPrefix(strings.TrimPrefix(settings.Endpoint, "http://"), "https://")
		minioClient, _ = minio.New(endpoint, &minio.Options{
			Creds:        credentials.NewStaticV4(settings.AccessKey, settings.SecretKey, ""),
			Secure:       useSSL,
			Region:       settings.Region,
			BucketLookup: minio.BucketLookupPath,
		})
	}

	rows, err := db.DB.Query(`
		SELECT id, database_id, filename, object_key, size_bytes, status, s3_url, error, created_at
		FROM backups WHERE database_id = ? ORDER BY created_at DESC
	`, databaseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var backups []Backup
	for rows.Next() {
		var b Backup
		var sb sql.NullInt64
		var s3url, errStr, objKey sql.NullString
		if err := rows.Scan(&b.ID, &b.DatabaseID, &b.Filename, &objKey, &sb, &b.Status, &s3url, &errStr, &b.CreatedAt); err != nil {
			return nil, err
		}
		if sb.Valid {
			b.SizeBytes = sb.Int64
		}
		if s3url.Valid {
			b.S3URL = s3url.String
		}
		if errStr.Valid {
			b.Error = errStr.String
		}

		// Generate signed URL if possible
		if minioClient != nil && b.Status == "completed" {
			key := ""
			if objKey.Valid && objKey.String != "" {
				key = objKey.String
			} else {
				// Fallback to reconstructing key from filename
				// This assumes prefix hasn't changed since backup
				key = fmt.Sprintf("%s/%s", strings.Trim(settings.PathPrefix, "/"), b.Filename)
				if settings.PathPrefix == "" || settings.PathPrefix == "/" {
					key = b.Filename
				}
			}

			// Sign it
			if key != "" {
				signedUrl, err := minioClient.PresignedGetObject(context.Background(), settings.Bucket, key, time.Hour*24, nil)
				if err == nil {
					b.S3URL = signedUrl.String()
				}
			}
		}

		backups = append(backups, b)
	}
	return backups, nil
}

func PerformBackup(databaseID int) error {
	settings, err := GetBackupSettings(databaseID)
	if err != nil {
		return fmt.Errorf("failed to get settings: %w", err)
	}

	// 1. Get Database Info
	var dbName, containerID string
	err = db.DB.QueryRow("SELECT name, container_id FROM databases WHERE id = ?", databaseID).Scan(&dbName, &containerID)
	if err != nil {
		return fmt.Errorf("database not found: %w", err)
	}

	// 2. Prepare S3 Client
	useSSL := !strings.HasPrefix(settings.Endpoint, "http://")
	endpoint := strings.TrimPrefix(strings.TrimPrefix(settings.Endpoint, "http://"), "https://")

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(settings.AccessKey, settings.SecretKey, ""),
		Secure:       useSSL,
		Region:       settings.Region,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return fmt.Errorf("failed to create s3 client: %w", err)
	}

	// 3. Prepare Docker Execution
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	// 4. Create Backup Record (Pending)
	filename := fmt.Sprintf("%s_%s.sql", dbName, time.Now().Format("20060102_150405"))

	// Determine object key early
	objectName := fmt.Sprintf("%s/%s", strings.Trim(settings.PathPrefix, "/"), filename)
	if settings.PathPrefix == "" || settings.PathPrefix == "/" {
		objectName = filename
	}

	res, err := db.DB.Exec(`
		INSERT INTO backups (database_id, filename, object_key, status, created_at)
		VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
	`, databaseID, filename, objectName)
	if err != nil {
		return err
	}
	backupID, _ := res.LastInsertId()

	// Update status helper
	updateStatus := func(status, errorMsg string, size int64, s3Url string) {
		_, _ = db.DB.Exec(`
			UPDATE backups SET status = ?, error = ?, size_bytes = ?, s3_url = ? WHERE id = ?
		`, status, errorMsg, size, s3Url, backupID)
	}

	// 5. Exec pg_dump
	// Use --column-inserts for better compatibility if needed, or custom format -Fc
	// Defaulting to plain SQL for now as requested
	cmd := []string{"pg_dump", "-U", "postgres", dbName}
	execConfig := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := cli.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		updateStatus("failed", "Docker exec create failed: "+err.Error(), 0, "")
		return err
	}

	resp, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
	if err != nil {
		updateStatus("failed", "Docker exec attach failed: "+err.Error(), 0, "")
		return err
	}
	defer resp.Close()

	// 6. Stream to S3
	pr, pw := io.Pipe()
	var uploadErr error
	var uploadInfo minio.UploadInfo

	go func() {
		defer pw.Close()
		// Send stdout to pipe (S3), stderr to log/discard
		_, err := stdcopy.StdCopy(pw, os.Stderr, resp.Reader)
		if err != nil {
			log.Printf("StdCopy error: %v", err)
			pw.CloseWithError(err)
		}
	}()

	uploadInfo, uploadErr = minioClient.PutObject(ctx, settings.Bucket, objectName, pr, -1, minio.PutObjectOptions{
		ContentType: "application/sql",
	})

	if uploadErr != nil {
		updateStatus("failed", "S3 Upload failed: "+uploadErr.Error(), 0, "")
		return uploadErr
	}

	// 7. Success
	s3Url := fmt.Sprintf("%s/%s/%s", settings.Endpoint, settings.Bucket, objectName)
	updateStatus("completed", "", uploadInfo.Size, s3Url)

	return nil
}

func RestoreBackup(databaseID int, backupID int) error {
	// 1. Get Backup Info and Settings
	var b Backup
	var objectKey sql.NullString
	err := db.DB.QueryRow(`SELECT filename, object_key FROM backups WHERE id = ? AND database_id = ?`, backupID, databaseID).Scan(&b.Filename, &objectKey)
	if err != nil {
		return fmt.Errorf("backup not found: %w", err)
	}

	settings, err := GetBackupSettings(databaseID)
	if err != nil {
		return fmt.Errorf("failed to get settings: %w", err)
	}

	// 2. Prepare S3 Client
	useSSL := !strings.HasPrefix(settings.Endpoint, "http://")
	endpoint := strings.TrimPrefix(strings.TrimPrefix(settings.Endpoint, "http://"), "https://")

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(settings.AccessKey, settings.SecretKey, ""),
		Secure:       useSSL,
		Region:       settings.Region,
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return fmt.Errorf("failed to create s3 client: %w", err)
	}

	// 3. Determine Object Key
	key := ""
	if objectKey.Valid && objectKey.String != "" {
		key = objectKey.String
	} else {
		key = fmt.Sprintf("%s/%s", strings.Trim(settings.PathPrefix, "/"), b.Filename)
		if settings.PathPrefix == "" || settings.PathPrefix == "/" {
			key = b.Filename
		}
	}

	// 4. Download Backup to Temp File
	// Just read straight from S3 into the docker exec command?
	// That avoids temp file management but is trickier with docker API.
	// Simpler: Download to host temp, copy to container, then exec.
	// Or simpler: Download to host temp, `cat file | docker exec -i ... psql` (using docker client API equivalent)

	// Let's stream: S3 Reader -> Docker Exec Stdin
	object, err := minioClient.GetObject(context.Background(), settings.Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return fmt.Errorf("failed to download backup: %w", err)
	}
	defer object.Close()

	// 5. Get Database Info
	var dbName, containerID string
	err = db.DB.QueryRow("SELECT name, container_id FROM databases WHERE id = ?", databaseID).Scan(&dbName, &containerID)
	if err != nil {
		return fmt.Errorf("database not found: %w", err)
	}

	// 6. Docker Client
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	// 7. Recreate Database (Terminate connections, Drop, Create)
	// We run these as separate commands to avoid transaction block issues and allow better error handling.

	// Helper to exec and check
	execPsql := func(sqlCmd string, stepName string) error {
		fullCmd := fmt.Sprintf(`psql -U postgres -d postgres -c "%s"`, sqlCmd)
		execConfig := container.ExecOptions{
			Cmd:          []string{"/bin/sh", "-c", fullCmd},
			AttachStdout: true,
			AttachStderr: true,
		}
		execID, err := cli.ContainerExecCreate(ctx, containerID, execConfig)
		if err != nil {
			return fmt.Errorf("failed to create %s exec: %w", stepName, err)
		}
		resp, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
		if err != nil {
			return fmt.Errorf("failed to attach %s exec: %w", stepName, err)
		}
		defer resp.Close()

		// Read output
		var outBuf strings.Builder
		_, _ = io.Copy(&outBuf, resp.Reader)

		// Check exit code
		inspect, err := cli.ContainerExecInspect(ctx, execID.ID)
		if err != nil {
			return fmt.Errorf("failed to inspect %s exec: %w", stepName, err)
		}
		if inspect.ExitCode != 0 {
			return fmt.Errorf("failed during %s (exit %d): %s", stepName, inspect.ExitCode, outBuf.String())
		}
		return nil
	}

	// 7a. Terminate Connections
	terminateCmd := fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid();", dbName)
	if err := execPsql(terminateCmd, "terminate connections"); err != nil {
		// Log but maybe continue? Sometimes it fails if no connections? No, select should succeed.
		return err
	}

	// 7b. Drop Database
	dropCmd := fmt.Sprintf("DROP DATABASE IF EXISTS \\\"%s\\\";", dbName)
	if err := execPsql(dropCmd, "drop database"); err != nil {
		return err
	}

	// 7c. Create Database
	createCmd := fmt.Sprintf("CREATE DATABASE \\\"%s\\\";", dbName)
	if err := execPsql(createCmd, "create database"); err != nil {
		return err
	}

	// 8. Restore Backup
	execConfigRestore := container.ExecOptions{
		Cmd:          []string{"psql", "-U", "postgres", "-d", dbName},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
	}

	execIDRestore, err := cli.ContainerExecCreate(ctx, containerID, execConfigRestore)
	if err != nil {
		return fmt.Errorf("failed to create restore exec: %w", err)
	}

	respRestore, err := cli.ContainerExecAttach(ctx, execIDRestore.ID, container.ExecStartOptions{})
	if err != nil {
		return fmt.Errorf("failed to attach restore exec: %w", err)
	}
	defer respRestore.Close()

	// Pipe S3 -> Docker Stdin
	// And Docker Stdout/Stderr -> Discard (or log)
	go func() {
		_, err := io.Copy(respRestore.Conn, object)
		if err != nil {
			log.Printf("Error piping backup to docker: %v", err)
		}
		respRestore.CloseWrite()
	}()

	// Read output to wait for finish
	// We want to capture stderr to report potential SQL errors
	var restoreOutBuf strings.Builder
	_, err = io.Copy(&restoreOutBuf, respRestore.Reader)
	if err != nil {
		log.Printf("Error reading restore output: %v", err)
	}

	// Check exit code
	inspectRestore, err := cli.ContainerExecInspect(ctx, execIDRestore.ID)
	if err != nil {
		return fmt.Errorf("failed to inspect restore exec: %w", err)
	}
	if inspectRestore.ExitCode != 0 {
		return fmt.Errorf("restore failed with exit code %d: %s", inspectRestore.ExitCode, restoreOutBuf.String())
	}

	return nil
}
