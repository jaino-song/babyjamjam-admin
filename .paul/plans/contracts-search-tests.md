# TDD Test Specifications: Contracts Page Search Feature

## Context

### Implementation Plan Reference
- **Source**: `.paul/plans/contracts-search.md`
- **Feature**: Client-side search functionality for contracts page
- **Scope**: Filter documents by customer name with TextField UI

### Test Infrastructure
- **Unit/Component Tests**: Jest + React Testing Library
- **E2E Tests**: Playwright
- **Test Patterns**: Follow existing patterns in `frontend/src/app/(components)/**/__tests__/`

---

## Test Strategy

### Unit Test Track (Jest + RTL)
- **Framework**: Jest with React Testing Library
- **Pattern**: `frontend/src/app/(components)/eformsign/__tests__/*.test.tsx`
- **Coverage Target**: 100% of filtering logic, 80% of UI interactions
- **Mocking Strategy**: Mock `useEformsignDocumentsByType` and `useEformsignAuth` hooks

### E2E Test Track (Playwright)
- **Framework**: Playwright
- **Pattern**: `frontend/tests/contracts-search.spec.ts`
- **Browsers**: chromium (as per existing config)
- **Base URL**: `http://localhost:3000`

---

## Phase 1: RED (Write Failing Tests)

> **Goal**: Define the contract through failing tests

### Unit Tests

#### Test Suite: DocumentsList Search Filtering Logic

**File**: `frontend/src/app/(components)/eformsign/__tests__/DocumentsList.search.test.tsx`

##### Test Group: Filtering Logic (useMemo)

- [ ] **Test**: should return all documents when search term is empty
  - **Input**: 
    - `documents`: `[{ customer_name: '홍길동' }, { customer_name: '김철수' }]`
    - `search`: `''`
  - **Expected Output**: All 2 documents returned
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(2)`
    - `expect(filteredDocuments[0].customer_name).toBe('홍길동')`

- [ ] **Test**: should return all documents when search term is whitespace only
  - **Input**: 
    - `documents`: `[{ customer_name: '홍길동' }, { customer_name: '김철수' }]`
    - `search`: `'   '` (spaces only)
  - **Expected Output**: All 2 documents returned
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(2)`

- [ ] **Test**: should filter documents by exact customer name match
  - **Input**: 
    - `documents`: `[{ customer_name: '홍길동' }, { customer_name: '김철수' }]`
    - `search`: `'홍길동'`
  - **Expected Output**: 1 document (홍길동)
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(1)`
    - `expect(filteredDocuments[0].customer_name).toBe('홍길동')`

- [ ] **Test**: should filter documents by partial customer name (substring)
  - **Input**: 
    - `documents`: `[{ customer_name: '홍길동' }, { customer_name: '홍길순' }, { customer_name: '김철수' }]`
    - `search`: `'홍길'`
  - **Expected Output**: 2 documents (홍길동, 홍길순)
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(2)`
    - `expect(filteredDocuments.map(d => d.customer_name)).toEqual(['홍길동', '홍길순'])`

- [ ] **Test**: should perform case-insensitive search (English names)
  - **Input**: 
    - `documents`: `[{ customer_name: 'John Doe' }, { customer_name: 'Jane Smith' }]`
    - `search`: `'john'`
  - **Expected Output**: 1 document (John Doe)
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(1)`
    - `expect(filteredDocuments[0].customer_name).toBe('John Doe')`

- [ ] **Test**: should trim search term before filtering
  - **Input**: 
    - `documents`: `[{ customer_name: '홍길동' }, { customer_name: '김철수' }]`
    - `search`: `'  홍길동  '` (with leading/trailing spaces)
  - **Expected Output**: 1 document (홍길동)
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(1)`
    - `expect(filteredDocuments[0].customer_name).toBe('홍길동')`

- [ ] **Test**: should handle null customer_name safely (treat as empty string)
  - **Input**: 
    - `documents`: `[{ customer_name: null }, { customer_name: '홍길동' }]`
    - `search`: `'홍'`
  - **Expected Output**: 1 document (홍길동)
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(1)`
    - `expect(filteredDocuments[0].customer_name).toBe('홍길동')`

- [ ] **Test**: should return empty array when no documents match search
  - **Input**: 
    - `documents`: `[{ customer_name: '홍길동' }, { customer_name: '김철수' }]`
    - `search`: `'박영희'`
  - **Expected Output**: Empty array
  - **Assertions**:
    - `expect(filteredDocuments).toHaveLength(0)`

##### Test Group: Search UI Rendering

- [ ] **Test**: should render TextField with placeholder "고객명 검색"
  - **Setup**: Render `<DocumentsList />` with mocked hooks
  - **Assertions**:
    - `expect(screen.getByPlaceholderText('고객명 검색')).toBeInTheDocument()`

- [ ] **Test**: should render search icon inside TextField as clickable IconButton
  - **Setup**: Render `<DocumentsList />` with mocked hooks
  - **Assertions**:
    - `expect(screen.getByRole('textbox')).toBeInTheDocument()`
    - Search icon button should be within InputAdornment

##### Test Group: Search Handlers

- [ ] **Test**: should update searchInput state on TextField change
  - **Setup**: Render `<DocumentsList />` with mocked hooks
  - **Action**: `fireEvent.change(textField, { target: { value: '홍길동' } })`
  - **Assertions**:
    - `expect(textField).toHaveValue('홍길동')`

- [ ] **Test**: should trigger search on Enter key press
  - **Setup**: 
    - Render `<DocumentsList />` with mocked documents
    - Type '홍길동' in TextField
  - **Action**: `fireEvent.keyDown(textField, { key: 'Enter' })`
  - **Assertions**:
    - Filtered results should show only matching documents
    - Page should reset to 0

- [ ] **Test**: should trigger search on search icon click
  - **Setup**: 
    - Render `<DocumentsList />` with mocked documents
    - Type '홍길동' in TextField
  - **Action**: Click search IconButton
  - **Assertions**:
    - Filtered results should show only matching documents
    - Page should reset to 0

- [ ] **Test**: should reset page to 0 when search is executed
  - **Setup**: 
    - Render `<DocumentsList />` with 10+ mocked documents
    - Navigate to page 2
    - Type search term
  - **Action**: Press Enter
  - **Assertions**:
    - Pagination should show page 1 (index 0)

##### Test Group: Combined Filtering (Search + Status)

- [ ] **Test**: should apply search filter on top of status-filtered documents
  - **Setup**: 
    - Mock `useEformsignDocumentsByType` to return status-filtered docs
    - Documents: `[{ customer_name: '홍길동', status: '완료' }, { customer_name: '김철수', status: '완료' }]`
  - **Action**: Search for '홍길동'
  - **Assertions**:
    - Only 1 document should be visible (홍길동 with 완료 status)
    - Status filter chip should still show selected status

---

### E2E Tests

#### Test Suite: Contracts Page Search Feature

**File**: `frontend/tests/contracts-search.spec.ts`

##### Test Group: Search UI Visibility

- [ ] **Test**: should display search TextField in toolbar
  - **Steps**:
    1. Navigate to `/contracts`
    2. Wait for page load
  - **Assertions**:
    - `expect(page.getByPlaceholder('고객명 검색')).toBeVisible()`
    - `expect(page.locator('[data-component="documents-list-toolbar"]')).toBeVisible()`

- [ ] **Test**: should display search icon as clickable button
  - **Steps**:
    1. Navigate to `/contracts`
    2. Wait for page load
  - **Assertions**:
    - Search icon should be visible within TextField
    - Search icon should be clickable (wrapped in IconButton)

##### Test Group: Search Functionality

- [ ] **Test**: should filter documents when user types and presses Enter
  - **Mock Data**:
    ```javascript
    {
      documents: [
        { id: 'doc-1', current_status: { step_recipients: [{ name: '홍길동' }] }, ... },
        { id: 'doc-2', current_status: { step_recipients: [{ name: '김철수' }] }, ... },
        { id: 'doc-3', current_status: { step_recipients: [{ name: '홍길순' }] }, ... },
      ]
    }
    ```
  - **Steps**:
    1. Navigate to `/contracts`
    2. Wait for documents to load
    3. Fill search field with '홍길'
    4. Press Enter
  - **Assertions**:
    - `expect(page.getByText('홍길동')).toBeVisible()`
    - `expect(page.getByText('홍길순')).toBeVisible()`
    - `expect(page.getByText('김철수')).not.toBeVisible()`

- [ ] **Test**: should filter documents when user clicks search icon
  - **Mock Data**: Same as above
  - **Steps**:
    1. Navigate to `/contracts`
    2. Wait for documents to load
    3. Fill search field with '김철수'
    4. Click search icon button
  - **Assertions**:
    - `expect(page.getByText('김철수')).toBeVisible()`
    - `expect(page.getByText('홍길동')).not.toBeVisible()`

- [ ] **Test**: should show all documents when search is cleared
  - **Mock Data**: Same as above
  - **Steps**:
    1. Navigate to `/contracts`
    2. Search for '홍길동'
    3. Clear search field
    4. Press Enter
  - **Assertions**:
    - All 3 documents should be visible

- [ ] **Test**: should show "문서가 없습니다" when no documents match search
  - **Mock Data**: Same as above
  - **Steps**:
    1. Navigate to `/contracts`
    2. Wait for documents to load
    3. Search for '박영희' (non-existent)
    4. Press Enter
  - **Assertions**:
    - `expect(page.getByText('문서가 없습니다')).toBeVisible()`

##### Test Group: Search + Status Filter Combination

- [ ] **Test**: should apply search within status-filtered results
  - **Mock Data**:
    - `/api/documents/completed` returns: `[{ name: '홍길동' }, { name: '김철수' }]`
  - **Steps**:
    1. Navigate to `/contracts`
    2. Select '완료' status filter
    3. Wait for filtered results
    4. Search for '홍길동'
    5. Press Enter
  - **Assertions**:
    - Only '홍길동' document visible
    - Status filter chip still shows '완료'

##### Test Group: Pagination Reset

- [ ] **Test**: should reset to first page when search is executed
  - **Mock Data**: 10+ documents
  - **Steps**:
    1. Navigate to `/contracts`
    2. Wait for documents to load
    3. Click next page button
    4. Verify on page 2
    5. Type search term
    6. Press Enter
  - **Assertions**:
    - Pagination should show "1-X of Y" (first page)

##### Test Group: Search Input Behavior

- [ ] **Test**: should NOT filter on every keystroke (only on Enter/click)
  - **Mock Data**: 3 documents
  - **Steps**:
    1. Navigate to `/contracts`
    2. Wait for documents to load
    3. Type '홍' in search field (without pressing Enter)
  - **Assertions**:
    - All 3 documents should still be visible
    - No filtering should occur until Enter/click

---

## Phase 2: GREEN (Implement to Pass)

> **Goal**: Write minimum code to make all tests pass

### Implementation Tasks (from contracts-search.md)

- [ ] 1. **Add search state variables**
  - **File**: `frontend/src/app/(components)/eformsign/DocumentsList.tsx`
  - **Tests to Pass**: 
    - "should update searchInput state on TextField change"
  - **References**: `frontend/src/features/employees/components/EmployeesTable.tsx:50-51`

- [ ] 2. **Add client-side filtering logic with useMemo**
  - **File**: `frontend/src/app/(components)/eformsign/DocumentsList.tsx`
  - **Tests to Pass**: 
    - All filtering logic tests (8 tests)
    - "should apply search filter on top of status-filtered documents"
  - **References**: `frontend/src/features/employees/components/EmployeesTable.tsx:61-71`

- [ ] 3. **Replace search IconButton with TextField**
  - **File**: `frontend/src/app/(components)/eformsign/DocumentsList.tsx`
  - **Tests to Pass**: 
    - "should render TextField with placeholder"
    - "should render search icon inside TextField"
    - E2E: "should display search TextField in toolbar"
  - **References**: `frontend/src/features/employees/components/EmployeesTable.tsx:162-178`

- [ ] 4. **Wire up search handlers**
  - **File**: `frontend/src/app/(components)/eformsign/DocumentsList.tsx`
  - **Tests to Pass**: 
    - "should trigger search on Enter key press"
    - "should trigger search on search icon click"
    - "should reset page to 0 when search is executed"
    - All E2E search functionality tests
  - **References**: `frontend/src/features/employees/components/EmployeesTable.tsx:73-81`

---

## Phase 3: REFACTOR (Keep Tests Green)

> **Goal**: Improve code quality while maintaining passing tests

- [ ] Extract filtering logic to custom hook if reusable
- [ ] Ensure consistent naming with EmployeesTable pattern
- [ ] Add data-testid attributes for E2E test stability

**Verification**: After each refactor step, run:
- `npm test -- --testPathPattern=DocumentsList.search` (Unit tests)
- `npx playwright test contracts-search.spec.ts` (E2E tests)

---

## Verification Commands

### Unit Tests
```bash
# Run specific test file
npm test -- --testPathPattern=DocumentsList.search

# Run with coverage
npm test -- --coverage --testPathPattern=DocumentsList.search
```

### E2E Tests
```bash
# Run specific test file
npx playwright test contracts-search.spec.ts

# Run with headed browser
npx playwright test contracts-search.spec.ts --headed

# Run with debug
npx playwright test contracts-search.spec.ts --debug
```

---

## Success Criteria

### RED Phase Complete When:
- [ ] Unit test file created: `frontend/src/app/(components)/eformsign/__tests__/DocumentsList.search.test.tsx`
- [ ] E2E test file created: `frontend/tests/contracts-search.spec.ts`
- [ ] `npm test` runs (and FAILS as expected for new tests)
- [ ] `npx playwright test contracts-search.spec.ts` runs (and FAILS as expected)

### GREEN Phase Complete When:
- [ ] All 16 unit tests pass
- [ ] All 8 E2E tests pass
- [ ] No TypeScript errors
- [ ] Search functionality works as specified

### REFACTOR Phase Complete When:
- [ ] Code follows EmployeesTable patterns
- [ ] All tests still pass
- [ ] No regressions in existing contracts page functionality

---

## Test Data Reference

### Mock Document Structure (for tests)
```typescript
const mockDocument: EformsignDocumentView = {
  doc_id: 'doc-1',
  customer_name: '홍길동',
  created_date: Date.now(),
  status: '완료',
};
```

### Mock Hook Response
```typescript
const mockUseEformsignDocumentsByType = {
  data: {
    documents: [
      { id: 'doc-1', current_status: { step_recipients: [{ name: '홍길동' }] }, ... },
    ],
  },
  isLoading: false,
  error: null,
  isFetching: false,
};
```

---

## Notes

### Key Implementation Details from Plan
1. **Field name**: `customer_name` (snake_case) - NOT `customerName`
2. **Search trigger**: Enter key OR icon click - NOT on every keystroke
3. **Event handler**: Use `onKeyDown` - NOT deprecated `onKeyPress`
4. **Null safety**: `(doc.customer_name || '').toLowerCase()`
5. **Page reset**: `setPage(0)` on search execution

### Existing Test Patterns to Follow
- Use `jest.mock()` for hook mocking (see `FilteredClientsDialog.test.tsx`)
- Use `fireEvent` for user interactions
- Use `waitFor` for async assertions
- E2E: Use `page.route()` for API mocking (see `contracts-skeleton-loading.spec.ts`)
