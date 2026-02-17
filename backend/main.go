package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/docker/go-connections/nat"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"baseful/auth"
	"baseful/backups"
	"baseful/db"
	"baseful/docker"
	"baseful/metrics"
	"baseful/proxy"
	"baseful/system"
)

func getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func generatePassword(length int) (string, error) {
	b := make([]byte, length)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b)[:length], nil
}

func main() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		// Suppress warning if variables are already provided by Docker/Environment
		if os.Getenv("JWT_SECRET") == "" {
			fmt.Println("Warning: No .env file found, using system environment variables")
		}
	}

	// Initialize database
	if err := db.InitDB(); err != nil {
		panic(err)
	}

	// Initialize metrics system
	if err := metrics.InitMetricsDB(); err != nil {
		fmt.Printf("Warning: Failed to initialize metrics DB: %v\n", err)
	} else {
		metrics.StartCollector()
	}

	// Initialize PostgreSQL Proxy - Check if we should only run the proxy
	if os.Getenv("PROXY_ONLY") == "true" {
		fmt.Println("Initializing PostgreSQL Proxy (Standalone mode)...")
		if err := proxy.Run(); err != nil {
			fmt.Printf("Error starting proxy: %v\n", err)
			os.Exit(1)
		}
		// Block forever as proxy is running
		select {}
	}

	// Normal startup: Continue with Docker and API initialization
	fmt.Println("Initializing Docker network...")
	if err := docker.EnsureNetwork(); err != nil {
		fmt.Printf("Warning: Failed to create Docker network: %v\n", err)
	}

	fmt.Println("Initializing PostgreSQL Proxy (Background mode)...")
	go func() {
		if err := proxy.Run(); err != nil {
			fmt.Printf("Error starting proxy: %v\n", err)
		}
	}()

	// Restore Web Server (Caddy) configuration if domain is set
	go func() {
		domain, _ := db.GetSetting("domain_name")
		if domain != "" {
			fmt.Printf("Restoring Web Server configuration for domain: %s\n", domain)
			if err := system.ProvisionSSL(domain); err != nil {
				fmt.Printf("Warning: Failed to restore Web Server configuration: %v\n", err)
			}
		}
	}()

	// Initialize update checker
	fmt.Println("Initializing Update Sentinel...")
	system.InitUpdateChecker()

	r := gin.Default()

	r.GET("/api/hello", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "Baseful API is running"})
	})

	r.GET("/api/system/update-status", func(c *gin.Context) {
		c.JSON(200, system.GetUpdateStatus())
	})

	// Web Server Endpoints
	r.GET("/api/system/webserver/status", func(c *gin.Context) {
		info, err := system.GetDomainInfo()
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, info)
	})

	r.POST("/api/system/webserver/domain", func(c *gin.Context) {
		var req struct {
			Domain string `json:"domain"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if err := system.SaveDomain(req.Domain); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "Domain saved"})
	})

	r.GET("/api/system/webserver/check-dns", func(c *gin.Context) {
		domain, _ := db.GetSetting("domain_name")
		if domain == "" {
			c.JSON(400, gin.H{"error": "No domain configured"})
			return
		}
		propagated, err := system.CheckPropagation(domain)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"propagated": propagated})
	})

	r.POST("/api/system/webserver/provision-ssl", func(c *gin.Context) {
		domain, _ := db.GetSetting("domain_name")
		if domain == "" {
			c.JSON(400, gin.H{"error": "No domain configured"})
			return
		}
		if err := system.ProvisionSSL(domain); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "SSL provisioned successfully"})
	})

	// Get monitoring settings
	r.GET("/api/settings", func(c *gin.Context) {
		enabled, _ := db.GetSetting("metrics_enabled")
		rateStr, _ := db.GetSetting("metrics_sample_rate")
		rate, _ := strconv.Atoi(rateStr)
		c.JSON(200, gin.H{
			"metrics_enabled":     enabled == "true",
			"metrics_sample_rate": rate,
		})
	})

	// Update monitoring settings
	r.POST("/api/settings", func(c *gin.Context) {
		var req struct {
			MetricsEnabled    bool   `json:"metrics_enabled"`
			MetricsSampleRate string `json:"metrics_sample_rate"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		enabledStr := "false"
		if req.MetricsEnabled {
			enabledStr = "true"
		}

		_ = db.UpdateSetting("metrics_enabled", enabledStr)
		_ = db.UpdateSetting("metrics_sample_rate", req.MetricsSampleRate)

		c.JSON(200, gin.H{"status": "ok"})
	})

	r.POST("/api/system/update-check", func(c *gin.Context) {
		system.CheckForUpdates()
		c.JSON(200, system.GetUpdateStatus())
	})

	r.POST("/api/system/update", func(c *gin.Context) {
		if err := system.RunUpdate(); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "Update initiated successfully. The system will restart in a few moments."})
	})

	// ========== BACKUPS API ==========
	r.GET("/api/databases/:id/backups", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		list, err := backups.ListBackups(id)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		// If list is nil (empty), return empty array
		if list == nil {
			list = []backups.Backup{}
		}
		c.JSON(200, list)
	})

	r.GET("/api/databases/:id/backups/settings", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		settings, err := backups.GetBackupSettings(id)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, settings)
	})

	r.POST("/api/databases/:id/backups/settings", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		var settings backups.BackupSettings
		if err := c.BindJSON(&settings); err != nil {
			c.JSON(400, gin.H{"error": "Invalid JSON"})
			return
		}
		settings.DatabaseID = id
		if err := backups.SaveBackupSettings(&settings); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"message": "Settings saved"})
	})

	r.POST("/api/databases/:id/backups/manual", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		go func() {
			fmt.Printf("Starting manual backup for DB %d...\n", id)
			if err := backups.PerformBackup(id); err != nil {
				fmt.Printf("Backup failed for DB %d: %v\n", id, err)
			} else {
				fmt.Printf("Backup completed for DB %d\n", id)
			}
		}()
		c.JSON(200, gin.H{"message": "Backup started"})
	})

	r.POST("/api/databases/:id/backups/:backupId/restore", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}
		backupIdStr := c.Param("backupId")
		backupId, err := strconv.Atoi(backupIdStr)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid backup ID"})
			return
		}

		go func() {
			fmt.Printf("Starting restore for DB %d from backup %d...\n", id, backupId)
			if err := backups.RestoreBackup(id, backupId); err != nil {
				fmt.Printf("Restore failed for DB %d: %v\n", id, err)
			} else {
				fmt.Printf("Restore completed for DB %d\n", id)
			}
		}()
		c.JSON(200, gin.H{"message": "Restore started"})
	})

	// ========== PROJECTS API ==========

	// Get all projects
	r.GET("/api/projects", func(c *gin.Context) {
		rows, err := db.DB.Query("SELECT id, name, description, created_at FROM projects ORDER BY created_at DESC")
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query projects: " + err.Error()})
			return
		}
		defer rows.Close()

		projects := []map[string]interface{}{}
		for rows.Next() {
			var id int
			var name, description, createdAt string
			if err := rows.Scan(&id, &name, &description, &createdAt); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan project: " + err.Error()})
				return
			}

			projects = append(projects, map[string]interface{}{
				"id":          id,
				"name":        name,
				"description": description,
				"created_at":  createdAt,
			})
		}

		c.JSON(http.StatusOK, projects)
	})

	// Create project
	r.POST("/api/projects", func(c *gin.Context) {
		var req struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Name == "" {
			c.JSON(400, gin.H{"error": "Project name is required"})
			return
		}

		result, err := db.DB.Exec(
			"INSERT INTO projects (name, description) VALUES (?, ?)",
			req.Name, req.Description,
		)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create project: " + err.Error()})
			return
		}

		id, _ := result.LastInsertId()
		c.JSON(201, gin.H{
			"id":          id,
			"name":        req.Name,
			"description": req.Description,
		})
	})

	// Get single project by ID
	r.GET("/api/projects/:id", func(c *gin.Context) {
		id := c.Param("id")
		var projectID int
		var name, description, createdAt string

		err := db.DB.QueryRow(
			"SELECT id, name, description, created_at FROM projects WHERE id = ?",
			id,
		).Scan(&projectID, &name, &description, &createdAt)

		if err != nil {
			c.JSON(404, gin.H{"error": "Project not found"})
			return
		}

		c.JSON(200, gin.H{
			"id":          projectID,
			"name":        name,
			"description": description,
			"created_at":  createdAt,
		})
	})

	// Get databases for a project
	r.GET("/api/projects/:id/databases", func(c *gin.Context) {
		id := c.Param("id")
		rows, err := db.DB.Query("SELECT id, name, type, host, port, status FROM databases WHERE project_id = ?", id)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query databases: " + err.Error()})
			return
		}
		defer rows.Close()

		databases := []map[string]interface{}{}
		for rows.Next() {
			var dbID, port int
			var name, dbType, host, status string
			if err := rows.Scan(&dbID, &name, &dbType, &host, &port, &status); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan database: " + err.Error()})
				return
			}

			databases = append(databases, map[string]interface{}{
				"id":     dbID,
				"name":   name,
				"type":   dbType,
				"host":   host,
				"port":   port,
				"status": status,
			})
		}

		c.JSON(http.StatusOK, databases)
	})

	// ========== DATABASES API ==========

	// Get all databases
	r.GET("/api/databases", func(c *gin.Context) {
		rows, err := db.DB.Query("SELECT id, name, type, host, port, status, project_id FROM databases")
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query databases: " + err.Error()})
			return
		}
		defer rows.Close()

		databases := []map[string]interface{}{}
		for rows.Next() {
			var id, port, projectID int
			var name, dbType, host, status string
			if err := rows.Scan(&id, &name, &dbType, &host, &port, &status, &projectID); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan database: " + err.Error()})
				return
			}

			databases = append(databases, map[string]interface{}{
				"id":        id,
				"name":      name,
				"type":      dbType,
				"host":      host,
				"port":      port,
				"status":    status,
				"projectId": projectID,
			})
		}

		c.JSON(http.StatusOK, databases)
	})

	// Create database
	r.POST("/api/databases", func(c *gin.Context) {
		var req struct {
			Name         string  `json:"name"`
			Type         string  `json:"type"`
			Version      string  `json:"version"`
			ProjectID    int     `json:"projectId"`
			MaxCPU       float64 `json:"maxCpu"`
			MaxRAMMB     int     `json:"maxRamMb"`
			MaxStorageMB int     `json:"maxStorageMb"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		// Set defaults if not provided
		if req.MaxCPU == 0 {
			req.MaxCPU = 1.0
		}
		if req.MaxRAMMB == 0 {
			req.MaxRAMMB = 512
		}
		if req.MaxStorageMB == 0 {
			req.MaxStorageMB = 1024
		}

		if req.Type != "postgresql" {
			c.JSON(400, gin.H{"error": "Only postgresql is supported for now"})
			return
		}

		// Validate project exists
		if req.ProjectID > 0 {
			var count int
			err := db.DB.QueryRow("SELECT COUNT(*) FROM projects WHERE id = ?", req.ProjectID).Scan(&count)
			if err != nil || count == 0 {
				c.JSON(400, gin.H{"error": "Invalid project ID"})
				return
			}
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker: " + err.Error()})
			return
		}
		defer cli.Close()

		imageName := fmt.Sprintf("postgres:%s", req.Version)
		if req.Version == "" {
			imageName = "postgres:latest"
		}

		// Pull image
		pullResp, err := cli.ImagePull(ctx, imageName, image.PullOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to pull image: " + err.Error()})
			return
		}
		defer pullResp.Close()
		io.Copy(os.Stdout, pullResp)

		// Get a free port for the database (for local access via proxy on host)
		freePort, err := getFreePort()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get free port: " + err.Error()})
			return
		}

		password, err := generatePassword(16)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate password"})
			return
		}

		// Generate unique container name
		randBytes := make([]byte, 8)
		rand.Read(randBytes)
		containerName := fmt.Sprintf("baseful-%s-%s", req.Name, hex.EncodeToString(randBytes))

		// Create container WITH port bindings for local access
		resp, err := cli.ContainerCreate(ctx, &container.Config{
			Image:    imageName,
			Hostname: req.Name,
			Env: []string{
				"POSTGRES_PASSWORD=" + password,
				"POSTGRES_DB=" + req.Name,
			},
			ExposedPorts: nat.PortSet{
				"5432/tcp": struct{}{},
			},
			Labels: map[string]string{
				"managed-by":         "baseful",
				"baseful.database":   req.Name,
				"baseful.project_id": fmt.Sprintf("%d", req.ProjectID),
			},
		}, &container.HostConfig{
			NetworkMode: docker.NetworkName,
			PortBindings: nat.PortMap{
				"5432/tcp": []nat.PortBinding{
					{HostIP: "0.0.0.0", HostPort: strconv.Itoa(freePort)},
				},
			},
			Resources: container.Resources{
				Memory:   int64(req.MaxRAMMB) * 1024 * 1024,
				NanoCPUs: int64(req.MaxCPU * 1000000000),
			},
			SecurityOpt: []string{
				"no-new-privileges:true",
			},
			CapDrop: []string{"ALL"},
			CapAdd:  []string{"CHOWN", "SETGID", "SETUID", "DAC_OVERRIDE"},
			RestartPolicy: container.RestartPolicy{
				Name: "unless-stopped",
			},
		}, nil, nil, containerName)

		if err != nil {
			fmt.Printf("Error creating container: %v\n", err)
			c.JSON(500, gin.H{"error": "Failed to create container: " + err.Error()})
			return
		}

		if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
			fmt.Printf("Error starting container: %v\n", err)
			_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
			c.JSON(500, gin.H{"error": "Failed to start container: " + err.Error()})
			return
		}

		// Store in DB (host is container name for internal Docker network access, mapped_port for host access)
		result, err := db.DB.Exec(
			"INSERT INTO databases (name, type, host, port, mapped_port, container_id, version, password, status, project_id, max_cpu, max_ram_mb, max_storage_mb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			req.Name, req.Type, containerName, 5432, freePort, resp.ID, req.Version, password, "active", req.ProjectID, req.MaxCPU, req.MaxRAMMB, req.MaxStorageMB,
		)

		if err != nil {
			fmt.Printf("Error saving to DB: %v\n", err)
			c.JSON(500, gin.H{"error": "Failed to save to database: " + err.Error()})
			return
		}

		databaseID, _ := result.LastInsertId()

		// Generate JWT token for this database
		tokenID, err := auth.GenerateTokenID()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate token ID"})
			return
		}

		jwtToken, err := auth.GenerateJWT(int(databaseID), 0, tokenID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate JWT token"})
			return
		}

		// Store token in database
		tokenHash := db.HashToken(jwtToken)
		expiresAt := time.Now().AddDate(2, 0, 0)
		if _, err := db.CreateToken(int(databaseID), tokenID, tokenHash, expiresAt); err != nil {
			c.JSON(500, gin.H{"error": "Failed to store token"})
			return
		}

		// Generate proxy connection string
		proxyHost := auth.GetProxyHost()
		proxyPort := auth.GetProxyPort()
		portInt, _ := strconv.Atoi(proxyPort)
		connectionString := auth.GenerateConnectionString(jwtToken, int(databaseID), proxyHost, portInt, "disable")

		c.JSON(200, gin.H{
			"message":           "Database created and started",
			"id":                databaseID,
			"container_id":      resp.ID,
			"connection_string": connectionString,
			"internal_host":     containerName,
			"internal_port":     5432,
		})
	})

	// Get single database by ID
	r.GET("/api/databases/:id", func(c *gin.Context) {
		id := c.Param("id")
		var db_id, port, projectID int
		var name, dbType, host, status, version, password, containerID string

		err := db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password, project_id, container_id FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password, &projectID, &containerID)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		// Get existing active token (don't regenerate on every fetch)
		tokenRecord, _ := db.GetActiveTokenForDatabase(db_id)

		proxyHost := auth.GetProxyHost()
		proxyPort := auth.GetProxyPort()
		portInt, _ := strconv.Atoi(proxyPort)

		// Return censored connection string (actual token not exposed)
		connectionString := auth.GenerateConnectionString("***CENSORED***", db_id, proxyHost, portInt, "disable")

		response := gin.H{
			"id":                db_id,
			"name":              name,
			"type":              dbType,
			"host":              host,
			"port":              port,
			"status":            status,
			"version":           version,
			"connection_string": connectionString,
			"projectId":         projectID,
			"container_id":      containerID,
		}

		if tokenRecord != nil {
			response["has_token"] = true
			response["token_id"] = tokenRecord.TokenID
			response["token_expires_at"] = tokenRecord.ExpiresAt
			response["token_revoked"] = tokenRecord.Revoked
		} else {
			response["has_token"] = false
		}

		c.JSON(200, response)
	})

	// Database Control Endpoints
	r.POST("/api/databases/:id/:action", func(c *gin.Context) {
		id := c.Param("id")
		action := c.Param("action")

		var containerID, status string
		err := db.DB.QueryRow("SELECT container_id, status FROM databases WHERE id = ?", id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		switch action {
		case "start":
			if err := cli.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to start container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE databases SET status = 'active' WHERE id = ?", id)
		case "stop":
			if err := cli.ContainerStop(ctx, containerID, container.StopOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to stop container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE databases SET status = 'stopped' WHERE id = ?", id)
		case "restart":
			if err := cli.ContainerRestart(ctx, containerID, container.StopOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to restart container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE databases SET status = 'active' WHERE id = ?", id)
		case "vacuum":
			var dbName string
			err := db.DB.QueryRow("SELECT name FROM databases WHERE id = ?", id).Scan(&dbName)
			if err != nil {
				c.JSON(404, gin.H{"error": "Database not found"})
				return
			}

			// Run VACUUM ANALYZE;
			command := fmt.Sprintf("psql -U postgres -d %s -c \"VACUUM ANALYZE;\"", dbName)
			res, err := docker.ExecCommand(containerID, command, "/")
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to vacuum database: " + err.Error()})
				return
			}

			if strings.Contains(res.Output, "ERROR") {
				c.JSON(500, gin.H{"error": "PostgreSQL error: " + res.Output})
				return
			}

			c.JSON(200, gin.H{"message": "Database vacuumed successfully", "output": res.Output})
			return
		case "delete":
			// Revoke all tokens first
			dbID, _ := strconv.Atoi(id)
			db.RevokeAllTokensForDatabase(dbID)

			// Stop and remove main container
			_ = cli.ContainerStop(ctx, containerID, container.StopOptions{})
			_ = cli.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true})
			// Delete tokens from DB
			db.DB.Exec("DELETE FROM database_tokens WHERE database_id = ?", id)
			// Delete from DB
			_, err = db.DB.Exec("DELETE FROM databases WHERE id = ?", id)
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to delete database"})
				return
			}
			c.JSON(200, gin.H{"message": "Database deleted"})
			return
		default:
			c.JSON(400, gin.H{"error": "Invalid action"})
			return
		}

		c.JSON(200, gin.H{"message": fmt.Sprintf("Database %sed", action)})
	})

	// ========== BRANCHES API ==========

	// Get all branches for a database
	r.GET("/api/databases/:id/branches", func(c *gin.Context) {
		id := c.Param("id")

		// Verify database exists
		var dbName string
		err := db.DB.QueryRow("SELECT name FROM databases WHERE id = ?", id).Scan(&dbName)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		rows, err := db.DB.Query("SELECT id, database_id, name, container_id, port, status, is_default, created_at FROM branches WHERE database_id = ? ORDER BY is_default DESC, created_at DESC", id)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to query branches: " + err.Error()})
			return
		}
		defer rows.Close()

		branches := []map[string]interface{}{}
		for rows.Next() {
			var branchID, databaseID, port int
			var name, containerID, status, createdAt string
			var isDefault bool
			if err := rows.Scan(&branchID, &databaseID, &name, &containerID, &port, &status, &isDefault, &createdAt); err != nil {
				c.JSON(500, gin.H{"error": "Failed to scan branch: " + err.Error()})
				return
			}

			branches = append(branches, map[string]interface{}{
				"id":           branchID,
				"database_id":  databaseID,
				"name":         name,
				"container_id": containerID,
				"port":         port,
				"status":       status,
				"is_default":   isDefault,
				"created_at":   createdAt,
			})
		}

		c.JSON(http.StatusOK, branches)
	})

	// Create a new branch
	r.POST("/api/databases/:id/branches", func(c *gin.Context) {
		id := c.Param("id")

		var req struct {
			Name string `json:"name"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Name == "" {
			c.JSON(400, gin.H{"error": "Branch name is required"})
			return
		}

		// Verify database exists and get details
		var dbID, dbPort int
		var dbName, dbType, dbHost, dbPassword, dbVersion, dbContainerID string
		err := db.DB.QueryRow(
			"SELECT id, name, type, host, port, password, version, container_id FROM databases WHERE id = ?",
			id,
		).Scan(&dbID, &dbName, &dbType, &dbHost, &dbPort, &dbPassword, &dbVersion, &dbContainerID)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		// Check if branch name already exists
		var count int
		err = db.DB.QueryRow("SELECT COUNT(*) FROM branches WHERE database_id = ? AND name = ?", id, req.Name).Scan(&count)
		if err != nil || count > 0 {
			c.JSON(400, gin.H{"error": "Branch with this name already exists"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker: " + err.Error()})
			return
		}
		defer cli.Close()

		// Get a free port for the new branch
		freePort, err := getFreePort()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get free port: " + err.Error()})
			return
		}

		// Generate unique container name
		randBytes := make([]byte, 8)
		rand.Read(randBytes)
		containerName := fmt.Sprintf("baseful-%s-%s-%s", dbName, req.Name, hex.EncodeToString(randBytes))

		// Create new container for the branch
		imageName := fmt.Sprintf("postgres:%s", dbVersion)
		if dbVersion == "" {
			imageName = "postgres:latest"
		}

		resp, err := cli.ContainerCreate(ctx, &container.Config{
			Image:    imageName,
			Hostname: req.Name,
			Env: []string{
				"POSTGRES_PASSWORD=" + dbPassword,
				"POSTGRES_DB=" + dbName,
			},
			ExposedPorts: nat.PortSet{
				"5432/tcp": struct{}{},
			},
			Labels: map[string]string{
				"managed-by":       "baseful",
				"baseful.branch":   req.Name,
				"baseful.database": dbName,
			},
		}, &container.HostConfig{
			NetworkMode: docker.NetworkName,
			PortBindings: nat.PortMap{
				"5432/tcp": []nat.PortBinding{
					{HostIP: "0.0.0.0", HostPort: strconv.Itoa(freePort)},
				},
			},
			SecurityOpt: []string{
				"no-new-privileges:true",
			},
			CapDrop: []string{"ALL"},
			CapAdd:  []string{"CHOWN", "SETGID", "SETUID", "DAC_OVERRIDE"},
			RestartPolicy: container.RestartPolicy{
				Name: "unless-stopped",
			},
		}, nil, nil, containerName)

		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create container: " + err.Error()})
			return
		}

		// Start the container
		if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
			_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
			c.JSON(500, gin.H{"error": "Failed to start container: " + err.Error()})
			return
		}

		// Wait for PostgreSQL to be ready
		time.Sleep(3 * time.Second)

		// Copy data from source database if it's not the first branch
		var sourceBranchCount int
		db.DB.QueryRow("SELECT COUNT(*) FROM branches WHERE database_id = ?", id).Scan(&sourceBranchCount)

		if sourceBranchCount > 0 {
			// Get the default branch container
			var sourceContainerID string
			err = db.DB.QueryRow("SELECT container_id FROM branches WHERE database_id = ? AND is_default = 1", id).Scan(&sourceContainerID)
			if err == nil {
				// Use pg_dump to copy data
				dumpCmd := []string{"pg_dump", "-U", "postgres", "-d", dbName, "--no-owner", "--no-acl"}
				dumpExec, err := cli.ContainerExecCreate(ctx, sourceContainerID, container.ExecOptions{
					Cmd:          dumpCmd,
					AttachStdout: true,
					AttachStderr: true,
				})
				if err == nil {
					dumpAttach, err := cli.ContainerExecAttach(ctx, dumpExec.ID, container.ExecAttachOptions{})
					if err == nil {
						defer dumpAttach.Close()

						// Create exec to restore in new container
						restoreCmd := []string{"psql", "-U", "postgres", "-d", dbName}
						restoreExec, err := cli.ContainerExecCreate(ctx, resp.ID, container.ExecOptions{
							Cmd:          restoreCmd,
							AttachStdin:  true,
							AttachStdout: true,
							AttachStderr: true,
						})
						if err == nil {
							restoreAttach, err := cli.ContainerExecAttach(ctx, restoreExec.ID, container.ExecAttachOptions{})
							if err == nil {
								defer restoreAttach.Close()
								io.Copy(restoreAttach.Conn, dumpAttach.Reader)
							}
						}
					}
				}
			}
		}

		// Store branch in database
		result, err := db.DB.Exec(
			"INSERT INTO branches (database_id, name, container_id, port, status, is_default) VALUES (?, ?, ?, ?, ?, ?)",
			id, req.Name, resp.ID, freePort, "running", 0,
		)

		if err != nil {
			_ = cli.ContainerStop(ctx, resp.ID, container.StopOptions{})
			_ = cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
			c.JSON(500, gin.H{"error": "Failed to save branch: " + err.Error()})
			return
		}

		branchID, _ := result.LastInsertId()

		c.JSON(200, gin.H{
			"message":      "Branch created successfully",
			"id":           branchID,
			"name":         req.Name,
			"container_id": resp.ID,
			"port":         freePort,
			"status":       "running",
		})
	})

	// Branch control endpoints
	r.POST("/api/databases/:id/branches/:branchId/:action", func(c *gin.Context) {
		id := c.Param("id")
		branchID := c.Param("branchId")
		action := c.Param("action")

		var containerID, status string
		err := db.DB.QueryRow("SELECT container_id, status FROM branches WHERE id = ? AND database_id = ?", branchID, id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Branch not found"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		switch action {
		case "start":
			if err := cli.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to start container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE branches SET status = 'running' WHERE id = ?", branchID)
		case "stop":
			if err := cli.ContainerStop(ctx, containerID, container.StopOptions{}); err != nil {
				c.JSON(500, gin.H{"error": "Failed to stop container: " + err.Error()})
				return
			}
			db.DB.Exec("UPDATE branches SET status = 'stopped' WHERE id = ?", branchID)
		case "delete":
			// Stop and remove container
			_ = cli.ContainerStop(ctx, containerID, container.StopOptions{})
			_ = cli.ContainerRemove(ctx, containerID, container.RemoveOptions{Force: true})
			// Delete from DB
			_, err = db.DB.Exec("DELETE FROM branches WHERE id = ?", branchID)
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to delete branch"})
				return
			}
			c.JSON(200, gin.H{"message": "Branch deleted"})
			return
		case "switch":
			// Set this branch as default, unset others
			db.DB.Exec("UPDATE branches SET is_default = 0 WHERE database_id = ?", id)
			db.DB.Exec("UPDATE branches SET is_default = 1 WHERE id = ?", branchID)
			c.JSON(200, gin.H{"message": "Switched to branch"})
			return
		default:
			c.JSON(400, gin.H{"error": "Invalid action"})
			return
		}

		c.JSON(200, gin.H{"message": fmt.Sprintf("Branch %sed", action)})
	})

	// SQL Query Endpoint
	r.POST("/api/databases/:id/query", func(c *gin.Context) {
		id := c.Param("id")

		var db_id, port int
		var name, dbType, host, status, version, password string
		err := db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		var req struct {
			Query string `json:"query"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Query == "" {
			c.JSON(400, gin.H{"error": "Query cannot be empty"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Get container ID from database record
		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		// Execute query using psql via docker exec
		cmd := []string{"psql", "-U", "postgres", "-d", name, "-c", req.Query}
		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec: " + err.Error()})
			return
		}

		// Attach to exec output
		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec: " + err.Error()})
			return
		}
		defer attachResp.Close()

		// Read output using stdcopy to handle Docker multiplexed stream
		var stdout, stderr bytes.Buffer
		_, err = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to read output: " + err.Error()})
			return
		}

		outputStr := stdout.String()
		if stderr.Len() > 0 && outputStr == "" {
			outputStr = stderr.String()
		}

		// Check if it's a SELECT query (returns results) or an action query
		isSelect := len(outputStr) > 0 && (outputStr[0] == '(' || outputStr[0] == '-' || len(outputStr) > 10)

		c.JSON(200, gin.H{
			"result":    outputStr,
			"is_select": isSelect,
		})
	})

	// List Tables Endpoint
	r.GET("/api/databases/:id/tables", func(c *gin.Context) {
		id := c.Param("id")

		var db_id, port int
		var name, dbType, host, status, version, password string
		err := db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		// Get list of tables
		cmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-c",
			"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"}
		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}

		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		defer attachResp.Close()

		var stdout, stderr bytes.Buffer
		_, err = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
		outputStr := stdout.String()

		// Parse table names
		tables := []map[string]interface{}{}
		for _, line := range strings.Split(outputStr, "\n") {
			tableName := strings.TrimSpace(line)
			if tableName != "" {
				// Get row count
				countCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-c",
					fmt.Sprintf("SELECT COUNT(*) FROM \"%s\"", tableName)}
				countExec, _ := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
					Cmd:          countCmd,
					AttachStdout: true,
					AttachStderr: true,
				})
				countAttach, _ := cli.ContainerExecAttach(ctx, countExec.ID, container.ExecAttachOptions{})

				var countStdout, countStderr bytes.Buffer
				_, _ = stdcopy.StdCopy(&countStdout, &countStderr, countAttach.Reader)
				countAttach.Close()

				countStr := strings.TrimSpace(countStdout.String())
				tables = append(tables, map[string]interface{}{
					"name":      tableName,
					"row_count": countStr,
				})
			}
		}

		c.JSON(200, tables)
	})

	// Get Table Data Endpoint
	r.GET("/api/databases/:id/tables/:tableName", func(c *gin.Context) {
		id := c.Param("id")
		tableName := c.Param("tableName")

		var db_id, port int
		var name, dbType, host, status, version, password string
		err := db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		// Get table schema (columns)
		schemaCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-A", "-F", "|", "-c",
			fmt.Sprintf("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '%s' ORDER BY ordinal_position", tableName)}
		schemaExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          schemaCmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}
		schemaAttach, err := cli.ContainerExecAttach(ctx, schemaExec.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		var schemaStdout, schemaStderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&schemaStdout, &schemaStderr, schemaAttach.Reader)
		schemaAttach.Close()

		// Parse columns
		columns := []map[string]interface{}{}
		for _, line := range strings.Split(schemaStdout.String(), "\n") {
			parts := strings.Split(strings.TrimSpace(line), "|")
			if len(parts) >= 3 {
				colName := strings.TrimSpace(parts[0])
				if colName != "" {
					columns = append(columns, map[string]interface{}{
						"name":     colName,
						"type":     strings.TrimSpace(parts[1]),
						"nullable": strings.TrimSpace(parts[2]),
					})
				}
			}
		}

		// Get pagination parameters
		offset := c.DefaultQuery("offset", "0")
		limit := c.DefaultQuery("limit", "100")

		// Get total count
		countCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-c",
			fmt.Sprintf("SELECT COUNT(*) FROM \"%s\"", tableName)}
		countExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          countCmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}
		countAttach, err := cli.ContainerExecAttach(ctx, countExec.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		var countStdout, countStderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&countStdout, &countStderr, countAttach.Reader)
		countAttach.Close()
		totalCount := strings.TrimSpace(countStdout.String())

		// Get table data with pagination
		dataCmd := []string{"psql", "-U", "postgres", "-d", name, "-t", "-A", "-F", "|", "-c",
			fmt.Sprintf("SELECT * FROM \"%s\" ORDER BY id LIMIT %s OFFSET %s", tableName, limit, offset)}
		dataExec, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          dataCmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to create exec"})
			return
		}
		dataAttach, err := cli.ContainerExecAttach(ctx, dataExec.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to exec"})
			return
		}
		var dataStdout, dataStderr bytes.Buffer
		_, err = stdcopy.StdCopy(&dataStdout, &dataStderr, dataAttach.Reader)
		dataAttach.Close()

		// Parse data rows
		rows := []map[string]interface{}{}
		dataLines := strings.Split(dataStdout.String(), "\n")
		for _, line := range dataLines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "(") || strings.HasPrefix(line, "-") {
				continue
			}
			// Simple parsing - split by pipe
			values := strings.Split(line, "|")
			if len(values) == len(columns) {
				row := make(map[string]interface{})
				for i, col := range columns {
					val := strings.TrimSpace(values[i])
					if val == "" || val == "NULL" {
						row[col["name"].(string)] = nil
					} else {
						row[col["name"].(string)] = val
					}
				}
				rows = append(rows, row)
			}
		}

		c.JSON(200, gin.H{
			"name":       tableName,
			"columns":    columns,
			"rows":       rows,
			"count":      len(rows),
			"totalCount": totalCount,
		})
	})

	// Update Table Row Endpoint
	r.PUT("/api/databases/:id/tables/:tableName/rows", func(c *gin.Context) {
		id := c.Param("id")
		tableName := c.Param("tableName")

		var db_id, port int
		var name, dbType, host, status, version, password string
		err := db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password FROM databases WHERE id = ?",
			id,
		).Scan(&db_id, &name, &dbType, &host, &port, &status, &version, &password)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not running"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		var containerID string
		err = db.DB.QueryRow("SELECT container_id FROM databases WHERE id = ?", id).Scan(&containerID)
		if err != nil {
			c.JSON(404, gin.H{"error": "Container not found"})
			return
		}

		var req struct {
			Updates []struct {
				RowID      interface{} `json:"rowId"`
				ColumnName string      `json:"columnName"`
				Value      interface{} `json:"value"`
			} `json:"updates"`
			PrimaryKey string `json:"primaryKey"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		fmt.Printf("Received request: primaryKey=%s, updates=%+v\n", req.PrimaryKey, req.Updates)

		// Execute each update
		for _, update := range req.Updates {
			var query string
			if update.Value == nil {
				query = fmt.Sprintf("UPDATE \"%s\" SET \"%s\" = NULL WHERE \"%s\" = '%v'", tableName, update.ColumnName, req.PrimaryKey, update.RowID)
			} else {
				query = fmt.Sprintf("UPDATE \"%s\" SET \"%s\" = '%v' WHERE \"%s\" = '%v'", tableName, update.ColumnName, update.Value, req.PrimaryKey, update.RowID)
			}

			fmt.Printf("Executing query: %s\n", query)

			cmd := []string{"psql", "-U", "postgres", "-d", name, "-c", query}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to create exec: " + err.Error()})
				return
			}

			attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
			if err != nil {
				c.JSON(500, gin.H{"error": "Failed to attach to exec"})
				return
			}
			var stdout, stderr bytes.Buffer
			_, err = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
			attachResp.Close()
			fmt.Printf("Query output: %s, stderr: %s\n", stdout.String(), stderr.String())
		}

		c.JSON(200, gin.H{"message": "Rows updated successfully"})
	})

	// ========== TOKEN MANAGEMENT API ==========

	// Get tokens for a database
	r.GET("/api/databases/:id/tokens", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}

		tokens, err := db.GetTokensForDatabase(databaseID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get tokens"})
			return
		}

		c.JSON(200, tokens)
	})

	// Rotate token for a database (creates new token, keeps old one active for overlap)
	r.POST("/api/databases/:id/tokens/rotate", func(c *gin.Context) {
		id := c.Param("id")
		databaseID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}

		// Generate new token
		tokenID, err := auth.GenerateTokenID()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate token ID"})
			return
		}

		jwtToken, err := auth.GenerateJWT(databaseID, 0, tokenID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate JWT token"})
			return
		}

		// Store new token
		tokenHash := db.HashToken(jwtToken)
		expiresAt := time.Now().AddDate(2, 0, 0)
		if _, err := db.CreateToken(databaseID, tokenID, tokenHash, expiresAt); err != nil {
			c.JSON(500, gin.H{"error": "Failed to store token"})
			return
		}

		// Generate connection string
		proxyHost := auth.GetProxyHost()
		proxyPort := auth.GetProxyPort()
		portInt, _ := strconv.Atoi(proxyPort)
		connectionString := auth.GenerateConnectionString(jwtToken, databaseID, proxyHost, portInt, "disable")

		c.JSON(200, gin.H{
			"message":           "Token rotated successfully",
			"token_id":          tokenID,
			"connection_string": connectionString,
			"expires_at":        expiresAt,
		})
	})

	// Revoke a specific token
	r.DELETE("/api/databases/:id/tokens/:token_id", func(c *gin.Context) {
		tokenID := c.Param("token_id")

		if err := db.RevokeToken(tokenID); err != nil {
			c.JSON(404, gin.H{"error": "Token not found"})
			return
		}

		c.JSON(200, gin.H{"message": "Token revoked successfully"})
	})

	// Get actual connection string (with warning - only shown once)
	r.GET("/api/databases/:id/connection-string", func(c *gin.Context) {
		id := c.Param("id")
		dbID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}

		// Get SSL mode from query parameter
		sslMode := c.DefaultQuery("ssl", "disable")
		// Handle "true" from frontend as "require"
		if sslMode == "true" {
			sslMode = "require"
		} else if sslMode != "require" && sslMode != "disable" {
			sslMode = "disable"
		}

		// Get existing active token
		tokenRecord, err := db.GetActiveTokenForDatabase(dbID)
		if err != nil || tokenRecord == nil {
			// Generate new token if none exists
			tokenID, _ := auth.GenerateTokenID()
			jwtToken, _ := auth.GenerateJWT(dbID, 0, tokenID)
			tokenHash := db.HashToken(jwtToken)
			expiresAt := time.Now().AddDate(2, 0, 0)
			db.CreateToken(dbID, tokenID, tokenHash, expiresAt)

			proxyHost := auth.GetProxyHost()
			if proxyHost == "localhost" || proxyHost == "0.0.0.0" {
				if publicIP, err := system.GetPublicIP(); err == nil {
					proxyHost = publicIP
				}
			}
			proxyPort := auth.GetProxyPort()
			portInt, _ := strconv.Atoi(proxyPort)
			connectionString := auth.GenerateConnectionString(jwtToken, dbID, proxyHost, portInt, sslMode)

			c.JSON(200, gin.H{
				"message":           "Database started",
				"connection_string": connectionString,
				"expires_at":        expiresAt,
				"warning":           "Copy this connection string now. You will not be able to see it again. Store it securely.",
				"ssl_enabled":       sslMode == "require",
			})
			return
		}

		// Generate JWT for existing token
		jwtToken, err := auth.GenerateJWT(dbID, 0, tokenRecord.TokenID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to generate connection string"})
			return
		}

		proxyHost := auth.GetProxyHost()
		if proxyHost == "localhost" || proxyHost == "0.0.0.0" {
			if publicIP, err := system.GetPublicIP(); err == nil {
				proxyHost = publicIP
			}
		}
		proxyPort := auth.GetProxyPort()
		portInt, _ := strconv.Atoi(proxyPort)
		connectionString := auth.GenerateConnectionString(jwtToken, dbID, proxyHost, portInt, sslMode)

		c.JSON(200, gin.H{
			"connection_string": connectionString,
			"expires_at":        tokenRecord.ExpiresAt,
			"warning":           "Copy this connection string now. You will not be able to see it again. Store it securely.",
		})
	})

	// ========== DATABASE METRICS ==========

	// Get database metrics (connections, size, etc.)
	r.GET("/api/databases/:id/metrics", func(c *gin.Context) {
		id := c.Param("id")
		dbID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}

		var port int
		var name, dbType, host, status, version, password, containerID string
		err = db.DB.QueryRow(
			"SELECT id, name, type, host, port, status, version, password, container_id FROM databases WHERE id = ?",
			id,
		).Scan(&dbID, &name, &dbType, &host, &port, &status, &version, &password, &containerID)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Get container stats
		statsReader, err := cli.ContainerStats(ctx, containerID, false)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get container stats"})
			return
		}
		defer statsReader.Body.Close()

		// Parse stats
		var stats struct {
			CPUStats struct {
				CPUUsage struct {
					TotalUsage float64 `json:"total_usage"`
				} `json:"cpu_usage"`
				SystemUsage float64 `json:"system_cpu_usage"`
				OnlineCPUs  float64 `json:"online_cpus"`
			} `json:"cpu_stats"`
			PreCPUStats struct {
				CPUUsage struct {
					TotalUsage float64 `json:"total_usage"`
				} `json:"cpu_usage"`
				SystemUsage float64 `json:"system_cpu_usage"`
			} `json:"precpu_stats"`
			MemoryStats struct {
				Usage float64 `json:"usage"`
				Limit float64 `json:"limit"`
			} `json:"memory_stats"`
		}
		if err := json.NewDecoder(statsReader.Body).Decode(&stats); err != nil {
			c.JSON(500, gin.H{"error": "Failed to parse stats"})
			return
		}
		statsReader.Body.Close()

		// Calculate CPU percentage using Docker's delta algorithm
		cpuPercent := 0.0
		cpuDelta := stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage
		systemDelta := stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage
		onlineCPUs := stats.CPUStats.OnlineCPUs
		if onlineCPUs == 0 {
			onlineCPUs = 1
		}

		if systemDelta > 0 && cpuDelta > 0 {
			cpuPercent = (cpuDelta / systemDelta) * onlineCPUs * 100.0
		}

		// Get active connections count (exclude metrics queries by application_name)
		var activeConnections int
		if status == "active" {
			cmd := []string{"psql", "-U", "postgres", "-t", "-c",
				"SELECT count(*) FROM pg_stat_activity WHERE application_name IS NULL OR application_name != 'baseful-metrics'"}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err == nil {
				attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
				if err == nil {
					var stdout bytes.Buffer
					var stderr bytes.Buffer
					_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
					attachResp.Close()
					output := strings.TrimSpace(stdout.String())
					activeConnections, err = strconv.Atoi(output)
					if err != nil {
						log.Printf("Failed to parse connection count: %v, output: %q, stderr: %q", err, output, stderr.String())
					}
				}
			}
		}

		// Get database size (using application_name to exclude from connection count)
		var dbSize string
		if status == "active" {
			cmd := []string{"psql", "-U", "postgres", "-t", "-c",
				fmt.Sprintf("SET application_name = 'baseful-metrics'; SELECT pg_size_pretty(pg_database_size('%s'))", name)}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err == nil {
				attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
				if err == nil {
					var stdout bytes.Buffer
					var stderr bytes.Buffer
					_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
					attachResp.Close()
					dbSize = strings.TrimSpace(stdout.String())
					if dbSize == "" && stderr.Len() > 0 {
						log.Printf("Failed to get database size, stderr: %q", stderr.String())
					}
				}
			}
		}

		// Calculate memory usage
		memoryUsageMB := stats.MemoryStats.Usage / 1024 / 1024
		memoryLimitMB := stats.MemoryStats.Limit / 1024 / 1024
		memoryPercent := 0.0
		if stats.MemoryStats.Limit > 0 {
			memoryPercent = (stats.MemoryStats.Usage / stats.MemoryStats.Limit) * 100
		}

		// Get extra performance metrics
		var cacheHitRatio float64
		var uptimeSeconds int
		var maxConnections int
		var totalTransactions int64
		var longestQuerySeconds float64

		if status == "active" {
			cmd := []string{"psql", "-U", "postgres", "-t", "-A", "-c",
				`SELECT json_build_object(
					'cache_hit_ratio', COALESCE(round(sum(blks_hit) * 100 / NULLIF(sum(blks_hit) + sum(blks_read), 0), 2), 0),
					'uptime_seconds', extract(epoch from now() - pg_postmaster_start_time())::int,
					'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
					'total_transactions', sum(xact_commit + xact_rollback),
					'longest_query_seconds', COALESCE((SELECT extract(epoch from max(now() - query_start)) FROM pg_stat_activity WHERE state != 'idle'), 0)
				) FROM pg_stat_database`}
			execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
				Cmd:          cmd,
				AttachStdout: true,
				AttachStderr: true,
			})
			if err == nil {
				attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
				if err == nil {
					var stdout bytes.Buffer
					_, _ = stdcopy.StdCopy(&stdout, &bytes.Buffer{}, attachResp.Reader)
					attachResp.Close()
					var extra struct {
						CacheHitRatio       float64 `json:"cache_hit_ratio"`
						UptimeSeconds       int     `json:"uptime_seconds"`
						MaxConnections      int     `json:"max_connections"`
						TotalTransactions   int64   `json:"total_transactions"`
						LongestQuerySeconds float64 `json:"longest_query_seconds"`
					}
					if err := json.Unmarshal(stdout.Bytes(), &extra); err == nil {
						cacheHitRatio = extra.CacheHitRatio
						uptimeSeconds = extra.UptimeSeconds
						maxConnections = extra.MaxConnections
						totalTransactions = extra.TotalTransactions
						longestQuerySeconds = extra.LongestQuerySeconds
					}
				}
			}
		}

		// Get latest I/O rates from metrics history
		var ioReadBps, ioWriteBps float64
		_ = metrics.MetricsDB.QueryRow("SELECT io_read_bps, io_write_bps FROM samples WHERE database_id = ? ORDER BY timestamp DESC LIMIT 1", id).Scan(&ioReadBps, &ioWriteBps)

		c.JSON(200, gin.H{
			"active_connections":    activeConnections,
			"database_size":         dbSize,
			"cpu_usage_percent":     cpuPercent,
			"memory_usage_mb":       memoryUsageMB,
			"memory_limit_mb":       memoryLimitMB,
			"memory_usage_percent":  memoryPercent,
			"cache_hit_ratio":       cacheHitRatio,
			"uptime_seconds":        uptimeSeconds,
			"max_connections":       maxConnections,
			"total_transactions":    totalTransactions,
			"longest_query_seconds": longestQuerySeconds,
			"io_read_bps":           ioReadBps,
			"io_write_bps":          ioWriteBps,
		})
	})

	// Get detailed database connections
	r.GET("/api/databases/:id/connections", func(c *gin.Context) {
		id := c.Param("id")
		var containerID, status string
		err := db.DB.QueryRow("SELECT container_id, status FROM databases WHERE id = ?", id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(200, []interface{}{})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Query pg_stat_activity
		// We exclude the metrics connection and the current psql command itself
		// Use -t (tuples only) and -A (unaligned) to get clean JSON output without headers/padding
		cmd := []string{"psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
			`SELECT json_agg(t) FROM (
				SELECT
					pid,
					usename as user,
					client_addr as ip,
					backend_start as started_at,
					state,
					query,
					application_name,
					backend_type
				FROM pg_stat_activity
				WHERE (application_name IS NULL OR application_name != 'baseful-metrics')
				AND pid != pg_backend_pid()
			) t`}

		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to execute command in container"})
			return
		}

		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to container exec"})
			return
		}
		defer attachResp.Close()

		var stdout, stderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)

		output := strings.TrimSpace(stdout.String())
		if output == "" || output == "null" {
			if stderr.Len() > 0 {
				log.Printf("psql error: %s", stderr.String())
			}
			c.JSON(200, []interface{}{})
			return
		}

		var connections []interface{}
		if err := json.Unmarshal([]byte(output), &connections); err != nil {
			log.Printf("Failed to parse connections JSON: %v, output: %s", err, output)
			c.JSON(200, []interface{}{})
			return
		}

		c.JSON(200, connections)
	})

	// Get database metrics history
	r.GET("/api/databases/:id/metrics/history", func(c *gin.Context) {
		id := c.Param("id")
		dbID, err := strconv.Atoi(id)
		if err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}

		history, err := metrics.GetHistory(dbID)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get metrics history"})
			return
		}

		c.JSON(200, history)
	})

	// Terminate a database connection
	r.POST("/api/databases/:id/connections/:pid/terminate", func(c *gin.Context) {
		id := c.Param("id")
		pid := c.Param("pid")

		var containerID, status string
		err := db.DB.QueryRow("SELECT container_id, status FROM databases WHERE id = ?", id).Scan(&containerID, &status)
		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		if status != "active" {
			c.JSON(400, gin.H{"error": "Database is not active"})
			return
		}

		ctx := context.Background()
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to connect to Docker"})
			return
		}
		defer cli.Close()

		// Execute pg_terminate_backend
		cmd := []string{"psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c",
			fmt.Sprintf("SELECT pg_terminate_backend(%s)", pid)}

		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          cmd,
			AttachStdout: true,
			AttachStderr: true,
		})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to execute command in container"})
			return
		}

		attachResp, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to attach to container exec"})
			return
		}
		defer attachResp.Close()

		var stdout, stderr bytes.Buffer
		_, _ = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)

		output := strings.TrimSpace(stdout.String())
		if output == "t" {
			c.JSON(200, gin.H{"message": "Connection terminated"})
		} else {
			c.JSON(500, gin.H{"error": "Failed to terminate connection", "details": stderr.String()})
		}
	})

	// ========== RESOURCE LIMITS ==========

	// Get resource limits for a database
	r.GET("/api/databases/:id/limits", func(c *gin.Context) {
		id := c.Param("id")

		var maxCPU float64
		var maxRAMMB, maxStorageMB int

		err := db.DB.QueryRow(
			"SELECT max_cpu, max_ram_mb, max_storage_mb FROM databases WHERE id = ?",
			id,
		).Scan(&maxCPU, &maxRAMMB, &maxStorageMB)

		if err != nil {
			c.JSON(404, gin.H{"error": "Database not found"})
			return
		}

		c.JSON(200, gin.H{
			"max_cpu":        maxCPU,
			"max_ram_mb":     maxRAMMB,
			"max_storage_mb": maxStorageMB,
		})
	})

	// Update resource limits for a database
	r.PUT("/api/databases/:id/limits", func(c *gin.Context) {
		id := c.Param("id")
		if _, err := strconv.Atoi(id); err != nil {
			c.JSON(400, gin.H{"error": "Invalid database ID"})
			return
		}

		var req struct {
			MaxCPU       float64 `json:"max_cpu"`
			MaxRAMMB     int     `json:"max_ram_mb"`
			MaxStorageMB int     `json:"max_storage_mb"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		// Validate input
		if req.MaxCPU < 0.1 || req.MaxCPU > 16 {
			c.JSON(400, gin.H{"error": "CPU must be between 0.1 and 16 cores"})
			return
		}
		if req.MaxRAMMB < 64 || req.MaxRAMMB > 32768 {
			c.JSON(400, gin.H{"error": "RAM must be between 64 MB and 32 GB"})
			return
		}
		if req.MaxStorageMB < 128 || req.MaxStorageMB > 1048576 {
			c.JSON(400, gin.H{"error": "Storage must be between 128 MB and 1 TB"})
			return
		}

		// Update database record
		_, err := db.DB.Exec(
			"UPDATE databases SET max_cpu = ?, max_ram_mb = ?, max_storage_mb = ? WHERE id = ?",
			req.MaxCPU, req.MaxRAMMB, req.MaxStorageMB, id,
		)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to update resource limits"})
			return
		}

		// Check if database is running and needs restart
		var status, containerID string
		db.DB.QueryRow("SELECT status, container_id FROM databases WHERE id = ?", id).Scan(&status, &containerID)

		needsRestart := status == "active"

		// If database is active, update container resources immediately
		if status == "active" && containerID != "" {
			ctx := context.Background()
			cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
			if err == nil {
				defer cli.Close()

				// Update container resources
				_, err = cli.ContainerUpdate(ctx, containerID, container.UpdateConfig{
					Resources: container.Resources{
						Memory:   int64(req.MaxRAMMB) * 1024 * 1024,
						NanoCPUs: int64(req.MaxCPU * 1000000000),
					},
				})
				if err != nil {
					// If update fails, still return success but indicate restart needed
					needsRestart = true
				}
			} else {
				needsRestart = true
			}
		}

		c.JSON(200, gin.H{
			"message":        "Resource limits updated successfully",
			"max_cpu":        req.MaxCPU,
			"max_ram_mb":     req.MaxRAMMB,
			"max_storage_mb": req.MaxStorageMB,
			"needs_restart":  needsRestart,
		})
	})

	// ========== DOCKER CONTAINERS ==========

	// List all containers
	r.GET("/api/docker/containers", func(c *gin.Context) {
		containers, err := docker.ListContainers()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to list containers: " + err.Error()})
			return
		}
		c.JSON(200, containers)
	})

	// Execute command in container
	r.POST("/api/docker/containers/:id/exec", func(c *gin.Context) {
		id := c.Param("id")
		var req struct {
			Command string `json:"command"`
			Cwd     string `json:"cwd"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		if req.Command == "" {
			c.JSON(400, gin.H{"error": "Command is required"})
			return
		}

		result, err := docker.ExecCommand(id, req.Command, req.Cwd)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to execute command: " + err.Error()})
			return
		}

		c.JSON(200, result)
	})

	// ========== DOCKER NETWORK STATUS ==========

	// Get Docker network status
	r.GET("/api/docker/network", func(c *gin.Context) {
		exists, err := docker.NetworkExists()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to check network"})
			return
		}

		if !exists {
			c.JSON(200, gin.H{
				"exists":  false,
				"message": "Network does not exist",
			})
			return
		}

		info, err := docker.GetNetworkInfo()
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to get network info"})
			return
		}

		c.JSON(200, gin.H{
			"exists":      true,
			"name":        info.Name,
			"driver":      info.Driver,
			"containers":  len(info.Containers),
			"ipam_driver": info.IPAM.Driver,
		})
	})

	// Get Proxy status
	r.GET("/api/docker/proxy", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"running": true,
			"port":    auth.GetProxyPort(),
			"host":    auth.GetProxyHost(),
		})
	})

	// Restart Proxy (not applicable for in-memory proxy)
	r.POST("/api/docker/proxy/restart", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "Proxy is running in-memory and cannot be restarted. Restart the main application instead.",
		})
	})

	r.Run(":8080")
}
