# Contracts Page Search Feature Implementation

## Context

### Original Request
Enable the disabled search icon on the contracts page and implement search functionality.

### Interview Summary
**Key Discussions**:
- **Search UI**: TextField in toolbar (consistent with EmployeesTable/ClientsTable patterns)
- **Search Type**: Client-side filtering (filter already-loaded documents in memory)
- **Searchable Fields**: Customer name only
- **Filter Combination**: Search works WITH existing status filter (combined filtering)

**Research Findings**:
- Current search icon at `DocumentsList.tsx:183-185` is non-functional (grey color, no handler)
- EmployeesTable provides the reference pattern for client-side search with TextField
- Documents are fetched via `useEformsignDocumentsByType` hook and transformed to `EformsignDocumentView`

**Technical Clarifications**:
- **Field name**: The view model `EformsignDocumentView` uses `customer_name` (snake_case) - see `frontend/src/app/lib/eformsign/types.ts:174`
- **Status filter**: Status filtering happens server-side via the `useEformsignDocumentsByType` hook parameter; search filters the already status-filtered result set client-side
- **Search trigger**: Search executes only on Enter key or icon click (not on every keystroke)

---

## Work Objectives

### Core Objective
Enable the search icon on the contracts page and implement client-side search functionality that filters documents by customer name, working in combination with the existing status filter.

### Concrete Deliverables
- Modified `frontend/src/app/(components)/eformsign/DocumentsList.tsx` with working search
- Search TextField in toolbar replacing the disabled icon
- Client-side filtering by customer name
- Combined filtering with status filter

### Definition of Done
- [ ] Search TextField appears in toolbar
- [ ] User can type and search by customer name
- [ ] Search filters documents client-side (on Enter key or icon click)
- [ ] Search works together with status filter (status is server-side, search is client-side on top)
- [ ] Pagination resets to page 0 when search is executed (Enter/click)
- [ ] Empty search (or whitespace-only) shows all documents (within status filter)

### Must Have
- TextField with search icon wrapped in IconButton inside InputAdornment
- Enter key triggers search (via `onKeyDown`, not deprecated `onKeyPress`)
- Case-insensitive substring search with `trim()` on committed term
- Null-safe filtering (treat missing `customer_name` as empty string)
- Combined with existing status filter (status = server-side, search = client-side)
- Page reset on search execution (Enter/click)

### Must NOT Have (Guardrails)
- Server-side API search (use client-side only)
- Document ID search
- Date range filtering
- Korean 초성 (chosung) search (out of scope for this task)
- Changes to the eformsign API hooks
- New translation keys (use existing or hardcode Korean)
- Auto-search on every keystroke (only on commit)

---

## Task Flow

```
Task 1 (Add state) → Task 2 (Add filtering logic) → Task 3 (Update UI) → Task 4 (Wire up handlers)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| N/A | All sequential | Single file modification, each task depends on previous |

| Task | Depends On | Reason |
|------|------------|--------|
| 2 | 1 | Filtering needs state variables |
| 3 | 1 | UI needs state variables |
| 4 | 2, 3 | Handlers connect UI to filtering |

---

## TODOs

- [ ] 1. Add search state variables

  **What to do**:
  - Add `useState` for `searchInput` (controlled input value)
  - Add `useState` for `search` (committed search term)
  - Place after existing state declarations (line ~99)

  **Must NOT do**:
  - Do not modify existing state variables
  - Do not add debouncing (keep it simple like EmployeesTable)

  **Parallelizable**: NO (first task)

  **References**:
  - `frontend/src/features/employees/components/EmployeesTable.tsx:50-51` - State pattern

  **Acceptance Criteria**:
  - [ ] `searchInput` state exists
  - [ ] `search` state exists
  - [ ] No TypeScript errors

---

- [ ] 2. Add client-side filtering logic with useMemo

  **What to do**:
  - Import `useMemo` from React
  - Create `filteredDocuments` using `useMemo`
  - Filter by `(doc.customer_name || '').toLowerCase().includes(search.trim().toLowerCase())`
  - Apply AFTER the existing `transformDocument` and null filtering (line ~147-149)
  - Update `paginatedDocuments` to use `filteredDocuments` instead of `documents`
  - If `search.trim()` is empty, return all documents (no filtering)

  **Field Reference**:
  - `EformsignDocumentView.customer_name` (snake_case) - defined at `frontend/src/app/lib/eformsign/types.ts:175`

  **Must NOT do**:
  - Do not modify the existing `transformDocument` function
  - Do not change the status filter logic (it's handled by the API hook)
  - Do not add Korean 초성 search

  **Parallelizable**: NO (depends on Task 1)

  **References**:
  - `frontend/src/features/employees/components/EmployeesTable.tsx:61-71` - Filtering pattern
  - `frontend/src/app/(components)/eformsign/DocumentsList.tsx:147-154` - Current document processing
  - `frontend/src/app/lib/eformsign/types.ts:173-178` - EformsignDocumentView type definition

  **Acceptance Criteria**:
  - [ ] `filteredDocuments` computed with `useMemo`
  - [ ] Filters by `customer_name` (case-insensitive, trimmed, null-safe)
  - [ ] Empty/whitespace-only search returns all documents
  - [ ] Pagination uses filtered documents

---

- [ ] 3. Replace search IconButton with TextField

  **What to do**:
  - Import `TextField` and `InputAdornment` from MUI
  - Replace the search IconButton (lines 182-185) with TextField
  - Use InputAdornment with IconButton wrapping the Search icon (for clickability)
  - Style to match existing toolbar layout (size="small")
  - Add placeholder text: "고객명 검색"

  **UI Structure**:
  ```tsx
  <TextField
    size="small"
    placeholder="고객명 검색"
    value={searchInput}
    onChange={(e) => setSearchInput(e.target.value)}
    onKeyDown={handleKeyDown}
    InputProps={{
      endAdornment: (
        <InputAdornment position="end">
          <IconButton size="small" onClick={handleSearch}>
            <Search size={20} />
          </IconButton>
        </InputAdornment>
      ),
    }}
  />
  ```

  **Must NOT do**:
  - Do not change the Filter button or Plus button
  - Do not modify the overall toolbar layout structure
  - Do not add new translation keys (hardcode Korean is acceptable)

  **Parallelizable**: NO (depends on Task 1)

  **References**:
  - `frontend/src/features/employees/components/EmployeesTable.tsx:162-178` - TextField pattern
  - `frontend/src/app/(components)/eformsign/DocumentsList.tsx:182-185` - Current search button

  **Acceptance Criteria**:
  - [ ] TextField renders in toolbar
  - [ ] Search icon wrapped in IconButton inside InputAdornment (clickable)
  - [ ] Placeholder text shows "고객명 검색"
  - [ ] Styling consistent with toolbar

---

- [ ] 4. Wire up search handlers

  **What to do**:
  - Add `handleSearch` function that sets `search` from `searchInput` and resets page to 0
  - Add `handleKeyDown` function (NOT `handleKeyPress` - deprecated) for Enter key detection
  - Use `event.key === 'Enter'` check in `handleKeyDown`
  - Add `onChange` handler to update `searchInput`
  - Add `onClick` handler to search IconButton

  **Handler Pattern**:
  ```tsx
  const handleSearch = () => {
    setSearch(searchInput);
    setPage(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };
  ```

  **Must NOT do**:
  - Do not use deprecated `onKeyPress` (use `onKeyDown` instead)
  - Do not add debouncing
  - Do not auto-search on every keystroke (only on Enter or icon click)

  **Parallelizable**: NO (depends on Tasks 2, 3)

  **References**:
  - `frontend/src/features/employees/components/EmployeesTable.tsx:73-81` - Handler pattern

  **Acceptance Criteria**:
  - [ ] Typing updates `searchInput`
  - [ ] Enter key triggers search (via `onKeyDown`)
  - [ ] Click on search icon triggers search
  - [ ] Page resets to 0 on search execution
  - [ ] Search filters documents correctly

---

## Success Criteria

### Final Checklist
- [ ] All "Must Have" present:
  - [ ] TextField with search icon
  - [ ] Enter key triggers search
  - [ ] Case-insensitive search
  - [ ] Combined with status filter
  - [ ] Page reset on search
- [ ] All "Must NOT Have" absent:
  - [ ] No server-side API calls for search
  - [ ] No Document ID search
  - [ ] No date range filtering
  - [ ] No Korean 초성 search
  - [ ] No changes to eformsign hooks
- [ ] No TypeScript errors
- [ ] Search works correctly with status filter
- [ ] UI matches existing patterns (EmployeesTable)
