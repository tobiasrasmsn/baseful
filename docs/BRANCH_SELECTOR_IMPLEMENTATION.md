# Branch Selector Implementation

## Overview

This document describes the implementation of the branch selector feature in Baseful, which allows users to select and switch between database branches directly from the sidebar.

## What Was Implemented

### 1. Branch Context (`BranchContext.tsx`)

Created a new React context to manage branch state across the application:

**Location:** `frontend/src/context/BranchContext.tsx`

**Features:**
- Manages the list of branches for the current database
- Tracks the currently selected branch
- Automatically fetches branches when database ID changes
- Auto-selects the default branch when available
- Provides `refreshBranches()` function for manual refresh

**API:**
```typescript
interface BranchContextType {
  selectedBranch: Branch | null;
  setSelectedBranch: (branch: Branch | null) => void;
  branches: Branch[];
  refreshBranches: () => Promise<void>;
  currentDatabaseId: number | null;
  setCurrentDatabaseId: (id: number | null) => void;
}
```

**Branch Interface:**
```typescript
export interface Branch {
  id: number;
  database_id: number;
  name: string;
  container_id: string;
  port: number;
  status: string;
  is_default: boolean;
  created_at: string;
}
```

### 2. Sidebar Branch Selector

Added a branch selector dropdown to the sidebar that appears when a database is selected.

**Location:** `frontend/src/components/dashboard/sidebar.tsx`

**Features:**
- Shows current branch name with a branch icon
- Dropdown displays all available branches
- Visual indication for default branch
- Click to select a different branch
- Automatically updates when branches change

**UI Components:**
- GitBranchIcon for visual identification
- CaretDownIcon for dropdown indicator
- Popover for dropdown menu
- Facehash avatars for branch identification

### 3. App Integration

Updated the application structure to include BranchProvider:

**Location:** `frontend/src/App.tsx`

**Changes:**
- Wrapped the main content with `BranchProvider`
- Ensures branch context is available throughout the app
- Maintains proper provider hierarchy: ProjectProvider → DatabaseProvider → BranchProvider

### 4. Database Detail Page Updates

Updated the database detail page to use branch context instead of manual fetching:

**Location:** `frontend/src/pages/DatabaseDetail.tsx`

**Changes:**
- Removed manual branch fetching logic
- Added `useBranch` hook to access selected branch
- Displays current branch name with a badge
- Automatically updates when branch selection changes

### 5. Branches Page Updates

Updated the branches page to use branch context:

**Location:** `frontend/src/pages/branches/Branches.tsx`

**Changes:**
- Removed manual state management for branches
- Uses `useBranch` hook for all branch operations
- Simplified component logic
- Better error handling

## How It Works

### Initialization Flow

1. **App Mounts:**
   - BranchProvider initializes with empty state
   - `currentDatabaseId` is `null`

2. **User Selects Database:**
   - Sidebar detects database selection
   - Calls `setCurrentDatabaseId(db.id)`
   - BranchProvider triggers branch fetch

3. **Branch Fetch:**
   - `BranchContext` calls `/api/databases/:id/branches`
   - Populates `branches` array
   - Auto-selects default branch (or first branch)

4. **Branch Selector Renders:**
   - Shows selected branch name
   - Displays dropdown with all branches
   - Highlights currently selected branch

### Branch Selection Flow

1. **User Clicks Branch Selector:**
   - Dropdown opens showing all branches
   - Each branch shows name and "default" badge if applicable

2. **User Selects Branch:**
   - Calls `setSelectedBranch(branch)`
   - Closes dropdown
   - Updates UI to show new branch

3. **Application Updates:**
   - All components using `useBranch` receive new selection
   - Database detail page updates branch badge
   - Future queries use selected branch's port

## Usage

### For Developers

**Using Branch Context in Components:**

```typescript
import { useBranch } from "@/context/BranchContext";

function MyComponent() {
  const { 
    selectedBranch, 
    branches, 
    refreshBranches,
    setCurrentDatabaseId 
  } = useBranch();

  // Get current branch
  console.log("Current branch:", selectedBranch?.name);

  // Get all branches
  console.log("All branches:", branches);

  // Refresh branches
  await refreshBranches();

  // Set database ID to fetch branches
  setCurrentDatabaseId(databaseId);

  return <div>...</div>;
}
```

**Accessing Branch Information:**

```typescript
// Get branch port for connections
const port = selectedBranch?.port;

// Check if branch is default
const isDefault = selectedBranch?.is_default;

// Get branch status
const status = selectedBranch?.status;
```

### For Users

**Selecting a Branch:**

1. Navigate to any database page
2. Look at the sidebar (left panel)
3. Below the database selector, you'll see a branch selector
4. Click on it to open the dropdown
5. Select the branch you want to work with

**Branch Indicators:**

- **Branch Icon:** Shows you're in branch selection mode
- **Branch Name:** Current selected branch
- **"default" Badge:** Indicates the production/default branch
- **Dropdown:** Shows all available branches

## Technical Details

### Context Provider Structure

```
App
└── ThemeProvider
    └── Router
        └── ProjectProvider
            └── DatabaseProvider
                └── BranchProvider
                    └── Sidebar
                    └── DatabaseDetail
                    └── Branches
                    └── Other Components
```

### State Management

**BranchContext State:**
- `branches`: Array of all branches for current database
- `selectedBranch`: Currently selected branch object
- `currentDatabaseId`: ID of database we're viewing
- `setCurrentDatabaseId`: Function to change database

**Auto-Selection Logic:**
```typescript
// When branches are fetched:
1. Find branch with is_default = true
2. If found, set as selectedBranch
3. Otherwise, select first branch in array
4. If no branches, selectedBranch = null
```

### API Integration

**Fetch Branches:**
```
GET /api/databases/:id/branches
Response: Branch[]
```

**Branch Actions:**
```
POST /api/databases/:id/branches/:branchId/:action
Actions: start, stop, delete, switch
```

### Component Updates

**Sidebar:**
- Added branch selector after database selector
- Only shows when database is selected
- Uses Popover component for dropdown

**DatabaseDetail:**
- Shows branch badge with current branch name
- Uses `selectedBranch` from context
- No longer fetches branches independently

**Branches Page:**
- Simplified to use branch context
- Removed duplicate state management
- Better integration with app-wide state

## Benefits

### 1. Centralized State Management
- Single source of truth for branch selection
- Consistent branch state across all components
- Easy to add new branch-aware features

### 2. Improved User Experience
- Quick branch switching from sidebar
- Visual feedback on current branch
- No need to navigate to branches page

### 3. Better Code Organization
- Reusable branch context
- Reduced code duplication
- Easier to maintain and extend

### 4. Enhanced Functionality
- Branch-aware queries (future)
- Branch-specific metrics (future)
- Branch-based routing (future)

## Future Enhancements

### Planned Features

1. **Branch-Aware Queries**
   - Use selected branch port for SQL queries
   - Show branch-specific data in tables
   - Branch-aware connection strings

2. **Branch Metrics**
   - Show metrics for selected branch
   - Compare branches side-by-side
   - Branch performance monitoring

3. **Branch Routing**
   - Include branch ID in URLs
   - Share links to specific branches
   - Branch-specific bookmarks

4. **Branch Actions in Sidebar**
   - Quick start/stop buttons
   - Branch creation shortcut
   - Branch switching confirmation

5. **Branch Indicators**
   - Color-coded branch status
   - Activity indicators
   - Branch health badges

## Troubleshooting

### Branch Selector Not Showing

**Problem:** Branch selector doesn't appear in sidebar

**Solutions:**
1. Ensure a database is selected
2. Check that `BranchProvider` is properly initialized
3. Verify database has branches created
4. Check browser console for errors

### Branches Not Loading

**Problem:** Branches array is empty

**Solutions:**
1. Verify `currentDatabaseId` is set correctly
2. Check API endpoint is responding
3. Ensure database has production branch created
4. Check network tab for failed requests

### Branch Selection Not Updating

**Problem:** Selected branch doesn't change UI

**Solutions:**
1. Verify `setSelectedBranch` is being called
2. Check that components are using `useBranch` hook
3. Ensure components are re-rendering on state change
4. Check for stale closures in event handlers

## Testing

### Manual Testing Checklist

- [ ] Branch selector appears when database selected
- [ ] Branch selector hides when no database selected
- [ ] Dropdown shows all branches
- [ ] Default branch is marked
- [ ] Clicking branch updates selection
- [ ] Selected branch shows in sidebar
- [ ] Database detail shows branch badge
- [ ] Branches page uses context
- [ ] Refresh branches works correctly
- [ ] Switching databases updates branches

### Integration Points

**Sidebar:**
- Database selection → Branch fetch
- Branch selection → UI update

**DatabaseDetail:**
- Branch context → Badge display
- Branch changes → UI update

**Branches Page:**
- Branch context → List display
- Branch actions → Context refresh

## Conclusion

The branch selector implementation provides a seamless way for users to manage and switch between database branches. By leveraging React Context, we've created a centralized state management system that makes it easy to add branch-aware features throughout the application.

The implementation follows React best practices, maintains clean separation of concerns, and provides a solid foundation for future enhancements to the branching system.