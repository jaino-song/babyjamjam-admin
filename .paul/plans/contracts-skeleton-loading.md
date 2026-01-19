# Contracts Page: Skeleton Loading

## Context

### Original Request
Replace loading spinners with skeleton loading on the contracts page. Show the page structure immediately with skeleton rows, then replace with actual content when data loads.

### Current State
- **File**: `frontend/src/app/(components)/eformsign/DocumentsList.tsx`
- Auth loading (line 134-140): Shows full-page `CircularProgress` spinner
- Data fetching (line 298-313): Shows `CircularProgress` inside table body
- Both block the UI structure from being visible

### Loading States (from source code)
```typescript
// Line 102: Auth hook
const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth();

// Line 105-108: Documents hook
const { data, isLoading, error, isFetching } = useEformsignDocumentsByType(
  isAuthenticated, 
  selectedFilter
);
```

**Loading state meanings:**
- `isLoadingAuth`: Initial authentication check
- `isLoading`: Initial data fetch (first load)
- `isFetching`: Any fetch including refetch (filter changes, etc.)

---

## Work Objectives

### Core Objective
Improve perceived performance by showing page structure immediately with skeleton placeholders during loading states.

### Concrete Deliverables
- Skeleton rows in table body during initial loading
- Full UI (toolbar, table headers, pagination) visible immediately
- Smooth transition from skeletons to actual data

### Definition of Done
- [x] Page structure visible immediately on load
- [x] Skeleton rows show during initial auth/data loading
- [x] Real data replaces skeletons when loaded
- [x] Error states still work correctly
- [x] Build passes

### Scope Boundaries
**INCLUDE:**
- Initial page load skeleton (auth + data loading)
- Filter change behavior (show existing data, not skeletons)

**EXCLUDE:**
- Search button functionality (non-functional, out of scope)
- Accessibility improvements (ARIA labels - future enhancement)

---

## Task Flow

```
Task 1 (imports) → Task 2 (remove early return) → Task 3 (loading variable)
                                                          ↓
Task 7 (pagination) ← Task 6 (table condition) ← Task 5 (data condition) ← Task 4 (skeleton rows)
```

---

## TODOs

- [x] 1. Update MUI imports

  **What to do**:
  - Add `Skeleton` to the MUI import statement (line 4-23)
  - Keep `CircularProgress` for now - verify it's not used elsewhere first
  - After confirming no other usage, remove `CircularProgress`

  **File**: `frontend/src/app/(components)/eformsign/DocumentsList.tsx`
  
  **Change imports to include Skeleton, remove CircularProgress:**
  ```typescript
  import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Alert,
    IconButton,
    TablePagination,
    Divider,
    Menu,
    MenuItem,
    ListItemIcon,
    ListItemText,
    Radio,
    Skeleton,
  } from "@mui/material";
  ```

  **Acceptance Criteria**:
  - [ ] `Skeleton` imported from @mui/material
  - [ ] `CircularProgress` removed (after confirming no other usage)

---

- [x] 2. Remove early return for auth loading

  **What to do**:
  - Delete the early return block (lines 133-140) that shows full-page spinner
  - **KEEP** the error state early return (lines 142-152) - errors should still display

  **Delete this block only**:
  ```typescript
  // Initial auth loading state only (not filter changes)
  if (isLoadingAuth) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }
  ```

  **DO NOT DELETE** the error handling block that follows it.

  **Acceptance Criteria**:
  - [ ] Auth loading early return removed
  - [ ] Error state early return preserved (lines 142-152)

---

- [x] 3. Add loading state variable

  **What to do**:
  - Add a computed loading state after `rowsPerPage` (around line 110)
  - This combines auth loading and initial data loading
  
  **Depends on**: Task 2 (isLoadingAuth must still be accessible)

  **Add after line 110**:
  ```typescript
  const rowsPerPage = 5;
  const isInitialLoading = isLoadingAuth || isLoading;
  ```

  **Rationale**: 
  - `isInitialLoading` = show skeleton rows (first page load)
  - `isFetching` without `isInitialLoading` = show existing data (filter changes)

  **Acceptance Criteria**:
  - [ ] `isInitialLoading` variable defined
  - [ ] Correctly combines `isLoadingAuth` and `isLoading`

---

- [x] 4. Replace loading spinner with skeleton rows

  **What to do**:
  - Replace the `isFetching` spinner block (lines 297-313) with skeleton rows
  - Show skeleton rows only during initial loading, NOT during filter changes
  - Use `rowsPerPage` variable for row count (already 5)

  **Depends on**: Task 3 (requires `isInitialLoading` variable)

  **Replace this block**:
  ```typescript
  {/* Loading spinner - only covers table body */}
  {isFetching && (
    <TableRow>
      <TableCell colSpan={3} sx={{ border: 0, p: 0 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            py: 8,
          }}
        >
          <CircularProgress size={40} />
        </Box>
      </TableCell>
    </TableRow>
  )}
  ```

  **With skeleton rows**:
  ```typescript
  {isInitialLoading && Array.from({ length: rowsPerPage }).map((_, index) => (
    <TableRow key={`skeleton-${index}`}>
      <TableCell align="center">
        <Skeleton variant="text" width="60%" sx={{ mx: "auto" }} />
      </TableCell>
      <TableCell align="center">
        <Skeleton variant="text" width="70%" sx={{ mx: "auto" }} />
      </TableCell>
      <TableCell align="center">
        <Skeleton variant="rounded" width={50} height={24} sx={{ mx: "auto" }} />
      </TableCell>
    </TableRow>
  ))}
  ```

  **Skeleton variant choices**:
  - Column 1 (customer name): `text` - matches text content
  - Column 2 (date): `text` - matches text content  
  - Column 3 (status): `rounded` - matches Chip shape

  **Acceptance Criteria**:
  - [ ] Skeleton rows render during initial loading
  - [ ] 5 skeleton rows shown (matching rowsPerPage)
  - [ ] Skeleton widths match column proportions

---

- [x] 5. Update data rows condition

  **What to do**:
  - Change the condition for showing data rows
  - Show data when NOT in initial loading state
  
  **Depends on**: Task 3 (requires `isInitialLoading` variable)

  **Change (around line 314)**:
  ```typescript
  // Before
  {!isFetching && paginatedDocuments.map((doc, index) => (
  
  // After
  {!isInitialLoading && paginatedDocuments.map((doc, index) => (
  ```

  **Rationale**: During filter changes (`isFetching` but not `isInitialLoading`), show existing data rather than skeletons for better UX.

  **Acceptance Criteria**:
  - [ ] Data rows hidden during initial loading
  - [ ] Data rows visible during filter changes (isFetching)

---

- [x] 6. Update table visibility condition

  **What to do**:
  - Update the condition that shows table vs "no documents" alert (line 255)
  - Show table structure during initial loading (even if documents array is empty)

  **Depends on**: Task 3 (requires `isInitialLoading` variable)

  **Change**:
  ```typescript
  // Before
  {documents.length > 0 || isFetching ? (
  
  // After  
  {documents.length > 0 || isInitialLoading ? (
  ```

  **Edge case handling**: 
  - During initial load: `isInitialLoading=true`, show skeleton rows
  - After load with no data: `isInitialLoading=false`, `documents.length=0`, show "no documents" alert

  **Acceptance Criteria**:
  - [ ] Table structure visible during initial loading
  - [ ] "No documents" alert shows only after loading completes with empty data

---

- [x] 7. Update pagination visibility

  **What to do**:
  - Always show pagination for layout consistency
  - Disable pagination controls during initial loading
  - Remove the `{!isFetching && ...}` wrapper

  **Depends on**: Task 3 (requires `isInitialLoading` variable)

  **Change (around lines 346-362)**:
  
  **Before**:
  ```typescript
  {!isFetching && (
    <TablePagination
      component="div"
      count={documents.length}
      rowsPerPage={rowsPerPage}
      page={page}
      onPageChange={handleChangePage}
      ...
    />
  )}
  ```

  **After** (remove condition wrapper, add disabled state):
  ```typescript
  <TablePagination
    component="div"
    count={isInitialLoading ? 0 : documents.length}
    rowsPerPage={rowsPerPage}
    page={page}
    onPageChange={handleChangePage}
    rowsPerPageOptions={[]}
    labelRowsPerPage=""
    slotProps={{
      actions: {
        previousButton: { disabled: isInitialLoading },
        nextButton: { disabled: isInitialLoading },
      },
    }}
    sx={{
      "& .MuiTablePagination-selectLabel": { display: "none" },
      "& .MuiTablePagination-select": { display: "none" },
      "& .MuiTablePagination-spacer": { display: "none" },
      "& .MuiTablePagination-displayedRows": { margin: 0 },
    }}
  />
  ```

  **Acceptance Criteria**:
  - [ ] Pagination always visible (no conditional wrapper)
  - [ ] Pagination buttons disabled during initial loading
  - [ ] Count shows 0 during loading, actual count after

---

## Success Criteria

### Final Checklist
- [ ] `CircularProgress` removed from imports and usage
- [ ] `Skeleton` imported and used for loading rows
- [ ] Skeleton rows appear during initial loading only
- [ ] Table headers visible immediately on page load
- [ ] Toolbar visible immediately on page load
- [ ] Pagination visible but disabled during loading
- [ ] Data replaces skeletons smoothly
- [ ] Filter changes don't show skeletons (show existing data)
- [ ] Error states still work correctly
- [ ] Build passes with `npm run build`

---

## Test Scenarios (for verification)

| Scenario | Expected Behavior |
|----------|-------------------|
| Initial page load | Skeleton rows visible, pagination disabled |
| After data loads | Real data replaces skeletons, pagination enabled |
| Filter change | Existing data stays visible (no skeletons) |
| Error during load | Error alert displays correctly |
| Empty data after load | "No documents" alert shows |
