# PostgreSQL Proxy with JWT Authentication

A high-performance PostgreSQL proxy server written in Go that provides JWT-based authentication and connection pooling for multi-tenant database access.

## Overview

This proxy replaces Supavisor with a custom, in-memory Go implementation that provides:
- JWT-based authentication for PostgreSQL connections
- Connection pooling per database
- Token revocation support
- PostgreSQL protocol compliance
- High performance with minimal overhead

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

### Database Functions

- `db.GetDatabaseByID(id)` - Get database connection info
- `db.TokenExistsAndValid(tokenID)` - Check token validity
- `auth.ValidateJWT(token)` - Validate JWT token

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

The proxy logs:

- Connection attempts (success/failure)
- Pool creation/deletion
- Authentication failures
- Connection errors

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