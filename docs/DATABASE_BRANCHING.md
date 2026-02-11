# Database Branching Feature

## Overview

The Database Branching feature allows you to create isolated copies (branches) of your PostgreSQL databases. Each branch runs in its own Docker container with its own port, enabling you to:
- Develop and test changes in isolation
- Maintain multiple versions of your database simultaneously
- Safely experiment with schema changes
- Switch between different database states

## Key Concepts

### Production Branch
Every database automatically gets a "production" branch created when the database is first initialized. This branch is marked as the default and cannot be deleted.

### Branch States
- **Running**: The branch's PostgreSQL container is active and accepting connections
- **Stopped**: The branch's container is stopped but not deleted

### Default Branch
The default branch is the primary branch that applications connect to by default. You can switch between branches to make a different branch the default.

## Architecture

### Backend (Go)

#### Database Schema
The `branches` table stores branch metadata:
```sql
CREATE TABLE branches (
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
```

#### API Endpoints

**List Branches**
```
GET /api/databases/:id/branches
```
Returns all branches for a database, ordered by default status first.

**Create Branch**
```
POST /api/databases/:id/branches
Content-Type: application/json

{
  "name": "staging"
}
```
Creates a new branch by:
1. Getting a free port
2. Creating a new Docker container
3. Copying data from the default branch using `pg_dump` and `psql`
4. Storing branch metadata

**Branch Actions**
```
POST /api/databases/:id/branches/:branchId/:action
```
Available actions:
- `start` - Start the branch's container
- `stop` - Stop the branch's container
- `delete` - Delete the branch and its container
- `switch` - Make this branch the default

### Frontend (React/TypeScript)

#### Components

**Branches Page** (`/pages/branches/Branches.tsx`)
- Lists all branches with their status, port, and creation date
- Provides buttons to start, stop, switch, and delete branches
- Includes a dialog to create new branches

**Database Detail Integration**
- Shows the current default branch name on the database detail page
- Displays branch information alongside database metrics

#### Features
- Visual branch identification using Facehash avatars
- Status badges (running/stopped)
- Default branch indicator
- Confirmation dialogs for destructive actions
- Loading states for async operations

## Usage

### Creating a Branch

1. Navigate to a database's Branches page
2. Click "New Branch"
3. Enter a branch name (e.g., "staging", "feature-x")
4. Click "Create Branch"

The system will:
- Allocate a free port
- Create a new PostgreSQL container
- Copy all data from the production branch
- Start the new container

### Switching Branches

1. On the Branches page, find the branch you want to switch to
2. Click the checkmark button (switch action)
3. The branch becomes the new default

### Managing Branches

**Start a Branch**
- Click the play button on a stopped branch

**Stop a Branch**
- Click the stop button on a running branch

**Delete a Branch**
- Click the trash button (only available for non-default branches)
- Confirm the deletion

## Technical Details

### Container Management

Each branch runs in its own Docker container with:
- Unique container name: `baseful-{database-name}-{branch-name}-{random}`
- Exposed port: 5432 (internal), mapped to a unique host port
- Network: Connected to the baseful Docker network
- Labels: `managed-by=baseful`, `baseful.branch={branch-name}`, `baseful.database={database-name}`

### Data Copying

When creating a new branch (not the first one):
1. Uses `pg_dump` on the default branch container
2. Pipes output to `psql` on the new branch container
3. Copies all data, schemas, and permissions

### Port Allocation

The system automatically finds free ports using the `getFreePort()` function, which:
- Binds to port 0 on localhost
- Returns the port assigned by the OS
- Ensures no port conflicts

### Database Deletion

When a database is deleted:
1. All branch containers are stopped and removed
2. Branch records are deleted from the database
3. The main database container is stopped and removed
4. Database record is deleted

## Integration with Supavisor

Currently, branches are managed independently of Supavisor. Each branch has its own direct PostgreSQL connection via its allocated port. Future enhancements could include:
- Supavisor pool configuration for each branch
- Automatic pool updates when branches are created/switched
- Branch-aware connection strings

## Limitations

1. **Production Branch**: Cannot be deleted
2. **Port Allocation**: Limited by available ports on the host system
3. **Storage**: Each branch maintains its own data, increasing storage usage
4. **Performance**: Branch creation involves data copying, which may take time for large databases

## Future Enhancements

- [ ] Branch merging capabilities
- [ ] Branch comparison tools
- [ ] Automatic cleanup of old branches
- [ ] Branch templates
- [ ] Supavisor integration for connection pooling
- [ ] Branch-specific resource limits
- [ ] Branch scheduling (auto-start/stop)
- [ ] Branch metrics and monitoring

## Troubleshooting

### Branch Creation Fails
- Check Docker daemon is running
- Verify sufficient disk space
- Ensure ports are available
- Check logs: `docker logs <container-id>`

### Branch Won't Start
- Check if port is already in use
- Verify container exists: `docker ps -a | grep baseful`
- Check Docker logs for errors

### Data Not Copied
- Ensure source branch is running
- Check `pg_dump` and `psql` are available in containers
- Verify network connectivity between containers

### Port Conflicts
- The system automatically allocates free ports
- If manual port assignment is needed, modify the `getFreePort()` function
- Check port usage: `netstat -an | grep LISTEN`
