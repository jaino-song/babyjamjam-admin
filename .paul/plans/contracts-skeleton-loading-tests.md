# TDD Test Specifications: Contracts Skeleton Loading

## Context

### Original Request
Create E2E test specifications for the contracts page skeleton loading feature. The implementation replaces loading spinners with skeleton rows for improved perceived performance.

### Implementation Plan Reference
- **File**: `.paul/plans/contracts-skeleton-loading.md`
- **Component**: `frontend/src/app/(components)/eformsign/DocumentsList.tsx`

### Test Strategy
- **Framework**: Playwright (existing infrastructure)
- **Pattern**: `frontend/tests/*.spec.ts`
- **Focus**: Observable UI behavior, not implementation details

---

## Test Infrastructure

### Existing Setup
- Playwright config: `frontend/playwright.config.ts`
- Auth state: `auth.json` (pre-authenticated)
- Base URL: `http://localhost:3000`
- API mocking pattern: `page.route()` for intercepting requests

### Test File Location
- **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`

---

## Phase 1: RED (Write Failing Tests)

> **Goal**: Define the contract through failing tests that specify expected skeleton loading behavior

### E2E Test Suite: Contracts Page Skeleton Loading

#### Test 1: Initial page load shows skeleton rows

- [ ] **Test**: `should display skeleton rows during initial page load`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock eformsign auth API to delay response by 500ms
    2. Mock documents API to delay response by 500ms
    3. Navigate to `/contracts`
    4. Immediately check for skeleton rows (before data loads)
  - **Assertions**:
    - `expect(page.locator('[data-testid="skeleton-row"]')).toHaveCount(5)` OR
    - `expect(page.locator('.MuiSkeleton-root')).toBeVisible()`
    - `expect(page.locator('[data-testid="documents-list-toolbar"]')).toBeVisible()` (toolbar visible immediately)
    - `expect(page.locator('th')).toHaveCount(3)` (table headers visible immediately)

#### Test 2: Skeleton rows disappear when data loads

- [ ] **Test**: `should replace skeleton rows with actual data when loading completes`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock eformsign auth API with immediate success
    2. Mock documents API with mock data (2-3 documents)
    3. Navigate to `/contracts`
    4. Wait for network idle
    5. Check that skeletons are gone and data is visible
  - **Assertions**:
    - `expect(page.locator('.MuiSkeleton-root')).not.toBeVisible()`
    - `expect(page.locator('tbody tr')).toHaveCount(expectedDocumentCount)`
    - `expect(page.locator('tbody').getByText('customer name')).toBeVisible()`

#### Test 3: Filter changes do NOT show skeletons

- [ ] **Test**: `should keep existing data visible during filter changes (no skeletons)`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock APIs with immediate responses
    2. Navigate to `/contracts`
    3. Wait for initial data to load
    4. Click filter button
    5. Select a different filter (e.g., "완료")
    6. Immediately check that existing data is still visible (not skeletons)
  - **Assertions**:
    - `expect(page.locator('.MuiSkeleton-root')).not.toBeVisible()` (no skeletons during filter change)
    - `expect(page.locator('tbody tr')).toBeVisible()` (existing rows still visible)
    - After filter completes: `expect(page.locator('tbody tr')).toHaveCount(filteredCount)`

#### Test 4: Error states still display correctly

- [ ] **Test**: `should display error alert when API fails`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock eformsign auth API to return error (status 500)
    2. Navigate to `/contracts`
    3. Wait for error state
  - **Assertions**:
    - `expect(page.locator('[role="alert"]')).toBeVisible()`
    - `expect(page.locator('[role="alert"]')).toContainText(/인증에 실패했습니다|실패/)`
    - `expect(page.locator('.MuiSkeleton-root')).not.toBeVisible()` (no skeletons on error)

- [ ] **Test**: `should display error alert when documents API fails`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock eformsign auth API with success
    2. Mock documents API to return error (status 500)
    3. Navigate to `/contracts`
    4. Wait for error state
  - **Assertions**:
    - `expect(page.locator('[role="alert"]')).toBeVisible()`
    - `expect(page.locator('[role="alert"]')).toContainText(/문서를 불러오는데 실패했습니다|실패/)`

#### Test 5: Pagination is disabled during loading, enabled after

- [ ] **Test**: `should show pagination disabled during initial loading`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock APIs with 1000ms delay
    2. Navigate to `/contracts`
    3. Immediately check pagination state
  - **Assertions**:
    - `expect(page.locator('.MuiTablePagination-root')).toBeVisible()` (pagination visible)
    - `expect(page.locator('.MuiTablePagination-actions button').first()).toBeDisabled()` (prev button disabled)
    - `expect(page.locator('.MuiTablePagination-actions button').last()).toBeDisabled()` (next button disabled)

- [ ] **Test**: `should enable pagination after data loads`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock APIs with immediate response and 10+ documents
    2. Navigate to `/contracts`
    3. Wait for data to load
    4. Check pagination state
  - **Assertions**:
    - `expect(page.locator('.MuiTablePagination-root')).toBeVisible()`
    - `expect(page.locator('.MuiTablePagination-actions button').last()).toBeEnabled()` (next button enabled when more pages)
    - `expect(page.locator('.MuiTablePagination-displayedRows')).toContainText(/1-5 of \d+/)` (shows correct count)

#### Test 6: Empty state displays correctly after loading

- [ ] **Test**: `should display "no documents" alert when data is empty`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock APIs with empty documents array
    2. Navigate to `/contracts`
    3. Wait for loading to complete
  - **Assertions**:
    - `expect(page.locator('.MuiSkeleton-root')).not.toBeVisible()` (no skeletons)
    - `expect(page.locator('[role="alert"]')).toBeVisible()`
    - `expect(page.locator('[role="alert"]')).toContainText('문서가 없습니다')`

#### Test 7: Table structure visible immediately

- [ ] **Test**: `should show table headers and toolbar immediately on page load`
  - **File**: `frontend/tests/contracts-skeleton-loading.spec.ts`
  - **Steps**:
    1. Mock APIs with 2000ms delay
    2. Navigate to `/contracts`
    3. Immediately check UI structure (within 100ms)
  - **Assertions**:
    - `expect(page.locator('[data-component="documents-list-toolbar"]')).toBeVisible()`
    - `expect(page.locator('thead th')).toHaveCount(3)`
    - `expect(page.locator('thead')).toContainText(/고객명|이름/)` (customer name header)
    - `expect(page.locator('thead')).toContainText(/날짜|생성/)` (date header)
    - `expect(page.locator('thead')).toContainText(/상태/)` (status header)

---

## Phase 2: GREEN (Implement to Pass)

> **Goal**: Implementation tasks are defined in `.paul/plans/contracts-skeleton-loading.md`

The implementation will:
1. Add `Skeleton` import from MUI
2. Remove early return for auth loading
3. Add `isInitialLoading` computed variable
4. Replace `CircularProgress` with skeleton rows
5. Update data rows condition to use `isInitialLoading`
6. Update table visibility condition
7. Update pagination to always show but disable during loading

---

## Phase 3: REFACTOR (Keep Tests Green)

> **Goal**: Improve code quality while maintaining passing tests

After implementation passes all tests:
- [ ] Remove unused `CircularProgress` import
- [ ] Verify no console warnings about missing keys
- [ ] Ensure skeleton animation is smooth (visual check)
- [ ] Verify accessibility (skeleton rows should not interfere with screen readers)

---

## Mock Data Specifications

### Mock Auth Response
```typescript
const MOCK_AUTH_RESPONSE = {
  access_token: 'mock-token',
  refresh_token: 'mock-refresh',
  expires_in: 3600,
};
```

### Mock Documents Response
```typescript
const MOCK_DOCUMENTS = {
  documents: [
    {
      id: 'doc-1',
      created_date: Date.now(),
      current_status: {
        status_type: 'doc_complete',
        step_recipients: [{ name: '홍길동' }],
      },
      last_editor: { name: '홍길동' },
      creator: { name: '관리자' },
    },
    {
      id: 'doc-2',
      created_date: Date.now() - 86400000,
      current_status: {
        status_type: 'doc_request_participant',
        step_recipients: [{ name: '김철수' }],
      },
      last_editor: null,
      creator: { name: '관리자' },
    },
    // Add more for pagination tests
  ],
};
```

### Mock Empty Response
```typescript
const MOCK_EMPTY_DOCUMENTS = {
  documents: [],
};
```

---

## API Routes to Mock

| Route Pattern | Purpose |
|---------------|---------|
| `**/api/eformsign/auth` | Authentication token |
| `**/api/eformsign/documents*` | Documents list |

---

## Test Execution Commands

```bash
# Run all skeleton loading tests
cd frontend && npx playwright test contracts-skeleton-loading.spec.ts

# Run with headed browser (for debugging)
cd frontend && npx playwright test contracts-skeleton-loading.spec.ts --headed

# Run specific test
cd frontend && npx playwright test contracts-skeleton-loading.spec.ts -g "should display skeleton rows"
```

---

## Success Criteria

### RED Phase Complete When:
- [x] Test file `frontend/tests/contracts-skeleton-loading.spec.ts` created
- [x] All 11 test cases defined with proper assertions
- [x] `npx playwright test contracts-skeleton-loading.spec.ts` runs

### GREEN Phase Complete When:
- [x] All 11 tests pass
- [x] No flaky tests
- [x] Build passes with `npm run build`

### REFACTOR Phase Complete When:
- [ ] Code is clean (no unused imports)
- [ ] All tests still pass
- [ ] Visual verification of smooth skeleton animation

---

## Data-TestId Requirements

The implementation should add these `data-testid` attributes for reliable test selectors:

| Element | data-testid |
|---------|-------------|
| Skeleton row | `skeleton-row` (optional, can use `.MuiSkeleton-root`) |
| Documents toolbar | `documents-list-toolbar` (already exists as `data-component`) |
| Table container | `documents-table` (optional) |

**Note**: Existing MUI class selectors (`.MuiSkeleton-root`, `.MuiTablePagination-root`) are acceptable for these tests since they're stable MUI classes.

---

## Test File Template

```typescript
import { test, expect } from '@playwright/test';

const MOCK_DOCUMENTS = {
  documents: [
    {
      id: 'doc-1',
      created_date: Date.now(),
      current_status: {
        status_type: 'doc_complete',
        step_recipients: [{ name: '홍길동' }],
      },
      last_editor: { name: '홍길동' },
      creator: { name: '관리자' },
    },
    {
      id: 'doc-2',
      created_date: Date.now() - 86400000,
      current_status: {
        status_type: 'doc_request_participant',
        step_recipients: [{ name: '김철수' }],
      },
      last_editor: null,
      creator: { name: '관리자' },
    },
  ],
};

const MOCK_EMPTY_DOCUMENTS = { documents: [] };

test.describe('Contracts Page Skeleton Loading', () => {
  test.describe('Initial Loading State', () => {
    test('should display skeleton rows during initial page load', async ({ page }) => {
      // Mock with delay to catch loading state
      await page.route('**/api/eformsign/auth', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'mock' }),
        });
      });

      await page.route('**/api/eformsign/documents*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.goto('/contracts');

      // Skeleton rows should be visible during loading
      await expect(page.locator('.MuiSkeleton-root').first()).toBeVisible({ timeout: 1000 });
      
      // Toolbar should be visible immediately
      await expect(page.locator('[data-component="documents-list-toolbar"]')).toBeVisible();
      
      // Table headers should be visible immediately
      await expect(page.locator('thead th')).toHaveCount(3);
    });

    test('should show table headers and toolbar immediately on page load', async ({ page }) => {
      await page.route('**/api/eformsign/auth', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'mock' }),
        });
      });

      await page.goto('/contracts');

      // These should be visible immediately (within 500ms)
      await expect(page.locator('[data-component="documents-list-toolbar"]')).toBeVisible({ timeout: 500 });
      await expect(page.locator('thead')).toBeVisible({ timeout: 500 });
    });
  });

  test.describe('Data Loading Complete', () => {
    test.beforeEach(async ({ page }) => {
      await page.route('**/api/eformsign/auth', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'mock' }),
        });
      });

      await page.route('**/api/eformsign/documents*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });
    });

    test('should replace skeleton rows with actual data when loading completes', async ({ page }) => {
      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      // Skeletons should be gone
      await expect(page.locator('.MuiSkeleton-root')).not.toBeVisible();

      // Data rows should be visible
      await expect(page.locator('tbody tr')).toHaveCount(2);
      await expect(page.locator('tbody').getByText('홍길동')).toBeVisible();
    });

    test('should enable pagination after data loads', async ({ page }) => {
      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      // Pagination should be visible and functional
      await expect(page.locator('.MuiTablePagination-root')).toBeVisible();
    });
  });

  test.describe('Filter Changes', () => {
    test('should keep existing data visible during filter changes (no skeletons)', async ({ page }) => {
      await page.route('**/api/eformsign/auth', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'mock' }),
        });
      });

      let requestCount = 0;
      await page.route('**/api/eformsign/documents*', async (route) => {
        requestCount++;
        if (requestCount > 1) {
          // Delay subsequent requests to test filter behavior
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      // Data should be visible
      await expect(page.locator('tbody tr')).toHaveCount(2);

      // Click filter button
      const filterButton = page.locator('[data-component="documents-list-toolbar"]').locator('button').nth(1);
      await filterButton.click();

      // Select a filter option
      await page.locator('[role="menuitem"]').filter({ hasText: '완료' }).click();

      // During filter change, existing data should still be visible (no skeletons)
      await expect(page.locator('.MuiSkeleton-root')).not.toBeVisible();
      await expect(page.locator('tbody tr')).toBeVisible();
    });
  });

  test.describe('Error States', () => {
    test('should display error alert when auth API fails', async ({ page }) => {
      await page.route('**/api/eformsign/auth', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Auth failed' }),
        });
      });

      await page.goto('/contracts');

      await expect(page.locator('[role="alert"]')).toBeVisible();
      await expect(page.locator('.MuiSkeleton-root')).not.toBeVisible();
    });

    test('should display error alert when documents API fails', async ({ page }) => {
      await page.route('**/api/eformsign/auth', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'mock' }),
        });
      });

      await page.route('**/api/eformsign/documents*', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Documents fetch failed' }),
        });
      });

      await page.goto('/contracts');

      await expect(page.locator('[role="alert"]')).toBeVisible();
    });
  });

  test.describe('Empty State', () => {
    test('should display "no documents" alert when data is empty', async ({ page }) => {
      await page.route('**/api/eformsign/auth', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'mock' }),
        });
      });

      await page.route('**/api/eformsign/documents*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_EMPTY_DOCUMENTS),
        });
      });

      await page.goto('/contracts');
      await page.waitForLoadState('networkidle');

      // No skeletons
      await expect(page.locator('.MuiSkeleton-root')).not.toBeVisible();

      // Empty state alert
      await expect(page.locator('[role="alert"]')).toBeVisible();
      await expect(page.locator('[role="alert"]')).toContainText('문서가 없습니다');
    });
  });

  test.describe('Pagination During Loading', () => {
    test('should show pagination disabled during initial loading', async ({ page }) => {
      await page.route('**/api/eformsign/auth', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ access_token: 'mock' }),
        });
      });

      await page.route('**/api/eformsign/documents*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_DOCUMENTS),
        });
      });

      await page.goto('/contracts');

      // Pagination should be visible but disabled
      await expect(page.locator('.MuiTablePagination-root')).toBeVisible({ timeout: 500 });
      
      // Navigation buttons should be disabled during loading
      const prevButton = page.locator('.MuiTablePagination-actions button').first();
      const nextButton = page.locator('.MuiTablePagination-actions button').last();
      
      await expect(prevButton).toBeDisabled();
      await expect(nextButton).toBeDisabled();
    });
  });
});
```
