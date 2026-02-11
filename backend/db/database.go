package db

import (
	"database/sql"
	"fmt"
	"os"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB() error {
	var err error
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./data.db"
	}
	readOnly := os.Getenv("DB_READ_ONLY") == "true"

	if readOnly {
		dbPath = dbPath + "?mode=ro"
	}

	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}

	// Configure for better concurrent access
	DB.SetMaxOpenConns(10)

	if readOnly {
		fmt.Println("Database initialized in READ-ONLY mode")
		return nil
	}

	// Enable WAL mode for better concurrent access
	if _, err := DB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		fmt.Printf("Warning: Failed to enable WAL mode: %v\n", err)
	}
	// Reduce busy timeout
	if _, err := DB.Exec("PRAGMA busy_timeout=5000"); err != nil {
		fmt.Printf("Warning: Failed to set busy timeout: %v\n", err)
	}

	// Create tables if they don't exist
	schema := `
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS databases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        project_id INTEGER,
        server_id INTEGER,
        host TEXT,
        port INTEGER,
        container_id TEXT,
        version TEXT,
        password TEXT,
        status TEXT DEFAULT 'running',
        max_cpu REAL DEFAULT 1.0,
        max_ram_mb INTEGER DEFAULT 512,
        max_storage_mb INTEGER DEFAULT 1024,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (server_id) REFERENCES servers(id)
    );

    CREATE TABLE IF NOT EXISTS database_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        database_id INTEGER NOT NULL,
        token_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked BOOLEAN DEFAULT 0,
        FOREIGN KEY (database_id) REFERENCES databases(id)
    );

    CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        database_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        container_id TEXT,
        port INTEGER,
        status TEXT DEFAULT 'running',
        is_default BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (database_id) REFERENCES databases(id)
    );
    `

	_, err = DB.Exec(schema)
	if err != nil {
		return err
	}

	// Migration: Add project_id column if it doesn't exist
	// SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we just ignore errors
	DB.Exec("ALTER TABLE databases ADD COLUMN project_id INTEGER DEFAULT 0")

	// Migration: Add resource limit columns if they don't exist
	DB.Exec("ALTER TABLE databases ADD COLUMN max_cpu REAL DEFAULT 1.0")
	DB.Exec("ALTER TABLE databases ADD COLUMN max_ram_mb INTEGER DEFAULT 512")
	DB.Exec("ALTER TABLE databases ADD COLUMN max_storage_mb INTEGER DEFAULT 1024")

	// Migration: Add mapped_port for local dev access (running proxy on host)
	DB.Exec("ALTER TABLE databases ADD COLUMN mapped_port INTEGER DEFAULT 0")

	return nil
}

// DatabaseInfo represents database connection information
type DatabaseInfo struct {
	ID         int
	Name       string
	Host       string
	Port       int
	MappedPort int
	Password   string
	Type       string
}

// GetDatabaseByID returns database connection information for a given ID
func GetDatabaseByID(databaseID int) (*DatabaseInfo, error) {
	var dbInfo DatabaseInfo
	err := DB.QueryRow(`
		SELECT id, name, host, port, mapped_port, password, type
		FROM databases
		WHERE id = ?
	`, databaseID).Scan(
		&dbInfo.ID, &dbInfo.Name, &dbInfo.Host,
		&dbInfo.Port, &dbInfo.MappedPort, &dbInfo.Password, &dbInfo.Type,
	)

	if err != nil {
		return nil, fmt.Errorf("database not found: %w", err)
	}

	return &dbInfo, nil
}
