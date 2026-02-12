# PostgreSQL Proxy with JWT Authentication

A high-performance PostgreSQL proxy server written in Go that provides JWT-based authentication and connection pooling for multi-tenant database access.

## Overview

This proxy replaces Supavisor with a custom, in-memory Go implementation that provides:
- JWT-based authentication for PostgreSQL connections
- Connection pooling per database
- Token revocation support
- PostgreSQL protocol compliance
- High performance with minimal overhead
- **SSL/TLS termination** for secure connections
- **Idle connection timeouts** to prevent resource exhaustion
- **Structured logging** with API access for monitoring

## Architecture

```
Client → Proxy (JWT Auth) → Connection Pool → PostgreSQL Database
```

### Components

1. **Proxy Server** (`proxy.go`)
   - Listens on port 6432 (configurable via `PROXY_PORT`)
   - Accepts PostgreSQL protocol connections
   - Validates JWT tokens from connection password
   - Proxies authenticated connections to actual databases

2. **Connection Pool** (integrated)
   - Maintains connection pools per database
   - Configurable pool size (default: 10)
   - Automatic connection health checks
   - Efficient connection reuse

3. **Authentication** (uses `auth` package)
   - JWT token validation
   - Token revocation checking
   - Database ID extraction from claims

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_PORT` | `6432` | Port for the proxy server |
| `PROXY_POOL_SIZE` | `10` | Maximum connections per pool |
| `PROXY_HOST` | `localhost` | Host for connection strings |
| `JWT_SECRET` | (generated) | Secret for JWT signing/validation |
| `PROXY_IDLE_TIMEOUT` | `30m` | Idle connection timeout duration |
| `PROXY_SSL_ENABLED` | `false` | Enable SSL/TLS termination |
| `PROXY_CERT_FILE` | - | Path to TLS certificate file |
| `PROXY_KEY_FILE` | - | Path to TLS private key file |
| `PROXY_LOG_PATH` | - | Path to log file for persistent logging |

### Connection String Format

Clients connect using this format:

```
postgresql://token:<JWT_TOKEN>@<PROXY_HOST>:<PROXY_PORT>/db_<DATABASE_ID>
```

Example:
```
postgresql://token:eyJhbGc...@localhost:6432/db_123
```

## Security Features

### JWT Authentication

- Tokens are validated on every connection
- Tokens must be active (not revoked) and not expired
- Claims include:
  - `database_id`: Target database ID
  - `token_id`: Unique token identifier
  - `type`: Token type (e.g., "database_access")

### Token Management

- Tokens are stored with SHA256 hashes in the database
- Tokens can be revoked via API
- Tokens expire after 2 years (configurable)
- Expired tokens are automatically cleaned up

### Connection Security

- Connection timeout (30 seconds) for authentication
- Password field contains JWT token
- Database credentials are never exposed to clients
- All connections use the proxy as an intermediary

### Idle Timeout Protection

The proxy implements automatic idle connection detection and cleanup:

- **Default idle timeout**: 30 minutes of inactivity
- **Idle checker**: Runs every minute to detect stale connections
- **Automatic cleanup**: Idle connections are closed gracefully
- **Activity tracking**: Last activity timestamp updated on every read/write

This prevents resource exhaustion from abandoned connections and ensures the proxy remains stable under high load.

### SSL/TLS Termination

The proxy supports SSL/TLS termination for secure client connections:

- **TLS 1.2/1.3 support**: Modern cipher suites only
- **Self-signed certificates**: Auto-generated for development
- **Custom certificates**: Load from files for production
- **mTLS support**: Optional client certificate verification

Enable TLS by setting `PROXY_SSL_ENABLED=true` and providing certificate files.

### Structured Logging

All proxy activity is logged with structured JSON format:

- **Connection events**: Connect, disconnect, authentication
- **Error tracking**: Failed auth, connection errors, timeouts
- **Performance metrics**: Bytes transferred, connection duration
- **In-memory storage**: Last 10,000 entries retained
- **File persistence**: Optional JSON log file output

Log entries include:
- Timestamp (UTC)
- Log level (INFO, WARN, ERROR, DEBUG)
- Connection metadata (IP, port, database ID)
- Action type (CONNECT, DISCONNECT, AUTH_SUCCESS, etc.)
- Duration and bytes transferred

## Performance Optimizations

1. **Connection Pooling**
   - Reuses connections across multiple clients
   - Reduces connection overhead
   - Configurable pool size limits

2. **Concurrent Handling**
   - Goroutine per connection
   - Non-blocking I/O
   - Efficient resource management

3. **Pool Configuration**
   - Min connections: 2 (warm pool)
   - Max connections: 10 (configurable)
   - Health check period: 1 minute
   - Max connection lifetime: 1 hour
   - Max idle time: 30 minutes

## API Integration

The proxy integrates with the main application via:

### Endpoints

- `GET /api/docker/proxy` - Get proxy status
- `POST /api/docker/proxy/restart` - Restart proxy (note: proxy runs in-memory)

### Monitoring API

The proxy exposes a comprehensive monitoring API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/proxy/status` | GET | Proxy status and statistics |
| `/api/proxy/stats` | GET | Connection statistics |
| `/api/proxy/logs` | GET | Filtered connection logs |
| `/api/proxy/logs/export` | GET | Export all logs as JSON |
| `/api/proxy/connections` | GET | Active connections list |
| `/api/proxy/revocations` | GET | List revoked tokens |
| `/api/proxy/revoke` | POST | Revoke a token |
| `/api/proxy/unrevoke` | POST | Unrevoke a token |

### Log Query Parameters

The `/api/proxy/logs` endpoint supports filtering:

- `level`: Filter by log level (INFO, WARN, ERROR, DEBUG)
- `action`: Filter by action type (CONNECT, DISCONNECT, AUTH_SUCCESS, etc.)
- `client_ip`: Filter by client IP address
- `limit`: Maximum entries to return (default: 100, max: 1000)

Example:
```bash
curl "/api/proxy/logs?level=ERROR&limit=50"
```

### Database Functions

- `db.GetDatabaseByID(id)` - Get database connection info
- `db.TokenExistsAndValid(tokenID)` - Check token validity
- `auth.ValidateJWT(token)` - Validate JWT token

### Token Revocation

The proxy implements comprehensive token revocation:

- **In-memory cache**: Fast revocation checking
- **Database integration**: Persistent revocation storage
- **API access**: Revoke/unrevoke tokens via HTTP
- **Batch operations**: Revoke multiple tokens at once
- **Automatic cleanup**: Expired revocation entries removed

Revoke a token:
```bash
curl -X POST "/api/proxy/revoke" \
  -H "Content-Type: application/json" \
  -d '{"token_id": "your-token-id", "revoked_by": "admin", "reason": "security incident"}'
```

## Usage Example

### Starting the Proxy

```go
import "baseful/proxy"

// Start proxy with default configuration
go func() {
    if err := proxy.Run(); err != nil {
        log.Printf("Error starting proxy: %v", err)
    }
}()
```

### Connecting from a Client

```bash
# Using psql
psql "postgresql://token:eyJhbGc...@localhost:6432/db_123"

# Using any PostgreSQL client
psql -h localhost -p 6432 -U token -d db_123
# Password: <JWT_TOKEN>
```

### Generating Connection Strings

```go
import "baseful/auth"

// Generate connection string
jwtToken := "eyJhbGc..."
databaseID := 123
host := "localhost"
port := 6432

connStr := auth.GenerateConnectionString(jwtToken, databaseID, host, port)
// Returns: "postgresql://token:eyJhbGc...@localhost:6432/db_123"
```

## Error Handling

The proxy sends PostgreSQL error messages for:

- **Invalid startup message**: Protocol errors
- **No password**: Missing authentication
- **Invalid token**: JWT validation failure
- **Token revoked/expired**: Token no longer valid
- **Database not found**: Target database unavailable
- **Connection failure**: Unable to connect to database

## Monitoring

### Connection Pool Statistics

```go
stats := pool.Stat()
fmt.Printf("Total connections: %d\n", stats.TotalConns())
fmt.Printf("Idle connections: %d\n", stats.IdleConns())
fmt.Printf("Acquire count: %d\n", stats.AcquireCount())
```

### Logging

The proxy logs with structured JSON format:

- Connection attempts (success/failure)
- Pool creation/deletion
- Authentication failures
- Connection errors
- Idle timeout events
- Token revocation events
- SSL/TLS handshake events

Access logs via API:
```bash
# Get recent logs
curl "/api/proxy/logs"

# Get logs by level
curl "/api/proxy/logs?level=WARN"

# Get logs by client IP
curl "/api/proxy/logs?client_ip=192.168.1.100"

# Export all logs
curl "/api/proxy/logs/export" -o proxy-logs.json
```

## Comparison with Supavisor

| Feature | Supavisor | Custom Proxy |
|---------|-----------|--------------|
| Deployment | Docker container | In-memory Go process |
| Configuration | Environment variables | Environment variables |
| Pooling | Built-in | pgxpool (configurable) |
| JWT Support | Built-in | Custom implementation |
| Token Revocation | Limited | Full database-backed |
| Resource Usage | Higher (container) | Lower (in-memory) |
| Startup Time | Slower (container) | Faster (in-process) |
| Flexibility | Fixed | Highly customizable |

## Development

### Adding New Features

1. **Custom Pool Configuration**: Modify `getPool()` method
2. **Additional Authentication**: Extend `handleConnection()`
3. **Protocol Extensions**: Update protocol handling functions
4. **Monitoring**: Add metrics collection

### Testing

```bash
# Run tests
go test ./proxy/...

# Run with coverage
go test -cover ./proxy/...
```

## Troubleshooting

### Connection Refused

- Check proxy is running: `GET /api/docker/proxy`
- Verify port: `PROXY_PORT` environment variable
- Check firewall settings

### Authentication Failed

- Verify JWT token is valid
- Check token is not revoked in database
- Ensure `JWT_SECRET` matches between generation and validation

### Pool Exhaustion

- Increase `PROXY_POOL_SIZE`
- Check for connection leaks
- Review pool statistics

### Database Connection Errors

- Verify database container is running
- Check network connectivity
- Ensure database credentials are correct

## License

This proxy is part of the Baseful project.