# TDD Test Specifications: Notification Bell Bug Fixes

## Context

### Original Request
Fix the notification bell component to:
1. Update badge count when clicking notifications (race condition fix)
2. Prevent splash screen from appearing on notification click (should only appear at app launch)

### Implementation Summary
The fix replaces `window.location.href` with `router.push()` for client-side navigation, which:
- Allows the `markAsRead` mutation to complete before navigation
- Prevents full page reload that resets splash screen state

### Related Implementation Plan
See: `.paul/plans/notification-bell-fixes.md`

---

## Test Strategy

### Unit Test Track (Jest)
- **Framework**: Jest (via Next.js built-in)
- **Pattern**: `src/**/__tests__/*.test.tsx`
- **Coverage Target**: 100% of `handleNotificationClick` function
- **Mocking Strategy**: Mock `useRouter`, `useMarkAsRead`, and other hooks
- **Required Dependencies**: `@testing-library/react`, `@testing-library/jest-dom`

### E2E Test Track (Playwright)
- **Framework**: Playwright
- **Pattern**: `tests/*.spec.ts`
- **Browsers**: chromium (as per existing config)
- **Viewports**: Desktop Chrome

---

## Phase 1: RED (Write Failing Tests)

> **Goal**: Define the contract through failing tests

### Unit Tests

#### Test Suite: NotificationBell Component

##### Common Test Setup (Required for ALL unit tests)

```typescript
// frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationBell } from '../NotificationBell';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock usePushNotification hooks
const mockMarkAsReadMutate = jest.fn();
const mockMarkAllAsReadMutate = jest.fn();

jest.mock('@/app/hooks/usePushNotification', () => ({
  useMarkAsRead: () => ({ mutate: mockMarkAsReadMutate }),
  useMarkAllAsRead: () => ({ mutate: mockMarkAllAsReadMutate, isPending: false }),
  useUnreadCount: () => ({ data: 3 }),
  useNotifications: () => ({ 
    data: [mockUnreadNotificationWithUrl], 
    isLoading: false 
  }),
  usePushNotification: () => ({ 
    isSupported: true, 
    isSubscribed: true, 
    permission: 'granted', 
    isLoading: false, 
    error: null,
    subscribe: jest.fn(),
  }),
}));

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
```

---

- [ ] **Test**: should call markAsRead.mutate when clicking unread notification
  - **File**: `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
  - **Render**:
    ```typescript
    render(<NotificationBell />);
    ```
  - **Steps**:
    1. Click notification bell to open popover
    2. Click on unread notification item
  - **Input**: Click on notification item where `isRead === false`
  - **Expected Output**: `mockMarkAsReadMutate` called with `notification.id`
  - **Assertions**:
    ```typescript
    // Open popover
    fireEvent.click(screen.getByTestId('notification-bell'));
    
    // Wait for popover to appear
    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });
    
    // Click unread notification
    fireEvent.click(screen.getByTestId('notification-item-unread'));
    
    // Verify mutation called
    expect(mockMarkAsReadMutate).toHaveBeenCalledWith(1);
    expect(mockMarkAsReadMutate).toHaveBeenCalledTimes(1);
    ```

---

- [ ] **Test**: should NOT call markAsRead.mutate when clicking already-read notification
  - **File**: `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
  - **Setup Override**: Mock `useNotifications` to return read notification
    ```typescript
    jest.mock('@/app/hooks/usePushNotification', () => ({
      // ... other mocks
      useNotifications: () => ({ 
        data: [mockReadNotificationWithUrl], 
        isLoading: false 
      }),
    }));
    ```
  - **Render**:
    ```typescript
    render(<NotificationBell />);
    ```
  - **Input**: Click on notification item where `isRead === true`
  - **Expected Output**: `mockMarkAsReadMutate` NOT called
  - **Assertions**:
    ```typescript
    // Open popover
    fireEvent.click(screen.getByTestId('notification-bell'));
    
    // Wait for popover
    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });
    
    // Click read notification (no -unread suffix)
    fireEvent.click(screen.getByTestId('notification-item'));
    
    // Verify mutation NOT called
    expect(mockMarkAsReadMutate).not.toHaveBeenCalled();
    ```

---

- [ ] **Test**: should call router.push with notification URL
  - **File**: `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
  - **Render**:
    ```typescript
    render(<NotificationBell />);
    ```
  - **Input**: Click notification with `data.url = "/clients/123"`
  - **Expected Output**: `mockPush` called with `/clients/123`
  - **Assertions**:
    ```typescript
    // Open popover
    fireEvent.click(screen.getByTestId('notification-bell'));
    
    // Wait for popover
    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });
    
    // Click notification with URL
    fireEvent.click(screen.getByTestId('notification-item-unread'));
    
    // Verify router.push called with correct URL
    expect(mockPush).toHaveBeenCalledWith('/clients/123');
    expect(mockPush).toHaveBeenCalledTimes(1);
    ```

---

- [ ] **Test**: should NOT call router.push when notification has no URL
  - **File**: `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
  - **Setup Override**: Mock `useNotifications` to return notification without URL
    ```typescript
    jest.mock('@/app/hooks/usePushNotification', () => ({
      // ... other mocks
      useNotifications: () => ({ 
        data: [mockNotificationWithoutUrl], 
        isLoading: false 
      }),
    }));
    ```
  - **Render**:
    ```typescript
    render(<NotificationBell />);
    ```
  - **Input**: Click notification with `data: null`
  - **Expected Output**: `mockPush` NOT called
  - **Assertions**:
    ```typescript
    // Open popover
    fireEvent.click(screen.getByTestId('notification-bell'));
    
    // Wait for popover
    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });
    
    // Click notification without URL
    fireEvent.click(screen.getByTestId('notification-item-unread'));
    
    // Verify router.push NOT called
    expect(mockPush).not.toHaveBeenCalled();
    ```

---

- [ ] **Test**: should close popover before navigation (verify via DOM)
  - **File**: `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
  - **Render**:
    ```typescript
    render(<NotificationBell />);
    ```
  - **Input**: Click notification with URL
  - **Expected Output**: Popover closes (removed from DOM) before router.push completes
  - **Assertions** (using DOM query approach):
    ```typescript
    // Open popover
    fireEvent.click(screen.getByTestId('notification-bell'));
    
    // Verify popover is open
    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });
    
    // Click notification
    fireEvent.click(screen.getByTestId('notification-item-unread'));
    
    // Verify popover is closed (MUI Popover uses role="presentation" for backdrop)
    await waitFor(() => {
      expect(screen.queryByTestId('notification-popover')).not.toBeVisible();
    });
    
    // Verify navigation happened
    expect(mockPush).toHaveBeenCalled();
    ```

---

- [ ] **Test**: should NOT call window.location.href (regression prevention)
  - **File**: `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
  - **Purpose**: Regression test - ensure we don't accidentally revert to window.location.href which caused the original bug (full page reload)
  - **Setup**: Spy on `window.location` setter
    ```typescript
    // Store original location
    const originalLocation = window.location;
    
    // Mock location to track assignments
    delete (window as any).location;
    window.location = { ...originalLocation, href: '' } as Location;
    const hrefSetter = jest.fn();
    Object.defineProperty(window.location, 'href', {
      set: hrefSetter,
    });
    ```
  - **Render**:
    ```typescript
    render(<NotificationBell />);
    ```
  - **Input**: Click notification with URL
  - **Expected Output**: `window.location.href` NOT modified
  - **Assertions**:
    ```typescript
    // Open popover and click notification
    fireEvent.click(screen.getByTestId('notification-bell'));
    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });
    fireEvent.click(screen.getByTestId('notification-item-unread'));
    
    // Verify window.location.href was NOT set
    expect(hrefSetter).not.toHaveBeenCalled();
    
    // Verify router.push was used instead
    expect(mockPush).toHaveBeenCalled();
    ```
  - **Cleanup**:
    ```typescript
    afterEach(() => {
      window.location = originalLocation;
    });
    ```

---

- [ ] **Test**: should handle notification.data without url property (edge case)
  - **File**: `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
  - **Setup Override**: Mock notification with data object but no url
    ```typescript
    const mockNotificationWithDataButNoUrl = {
      id: 4,
      title: "Data without URL",
      body: "Has data object but no url property",
      data: { otherProp: 'value' }, // data exists but no url
      sentAt: new Date().toISOString(),
      readAt: null,
      isRead: false,
    };
    ```
  - **Render**:
    ```typescript
    render(<NotificationBell />);
    ```
  - **Input**: Click notification with `data: { otherProp: 'value' }` (no `url`)
  - **Expected Output**: No navigation, no error
  - **Assertions**:
    ```typescript
    // Open popover and click notification
    fireEvent.click(screen.getByTestId('notification-bell'));
    await waitFor(() => {
      expect(screen.getByTestId('notification-popover')).toBeVisible();
    });
    fireEvent.click(screen.getByTestId('notification-item-unread'));
    
    // Verify no navigation
    expect(mockPush).not.toHaveBeenCalled();
    
    // Verify no error shown
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    ```

---

### E2E Tests

#### Test Suite: Notification Bell Navigation

##### Common E2E Test Setup

```typescript
// frontend/tests/notification-bell.spec.ts

import { test, expect } from '@playwright/test';

// Deterministic test data - mock API responses
const MOCK_NOTIFICATIONS = [
  {
    id: 1,
    title: "테스트 알림 1",
    body: "첫 번째 테스트 알림",
    data: { url: "/clients/1" },
    sentAt: new Date().toISOString(),
    readAt: null,
    isRead: false,
  },
  {
    id: 2,
    title: "테스트 알림 2",
    body: "두 번째 테스트 알림",
    data: { url: "/employees/2" },
    sentAt: new Date().toISOString(),
    readAt: null,
    isRead: false,
  },
  {
    id: 3,
    title: "읽은 알림",
    body: "이미 읽은 알림",
    data: { url: "/messages" },
    sentAt: new Date().toISOString(),
    readAt: new Date().toISOString(),
    isRead: true,
  },
];

// Initial unread count: 2 (notifications 1 and 2)
const INITIAL_UNREAD_COUNT = 2;

test.describe('Notification Bell Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Mock notifications API with deterministic data
    await page.route('**/api/notifications', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_NOTIFICATIONS),
      });
    });

    // Mock unread count API - starts at 2
    let currentUnreadCount = INITIAL_UNREAD_COUNT;
    await page.route('**/api/notifications/unread/count', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: currentUnreadCount }),
      });
    });

    // Mock mark as read API - decrements count
    await page.route('**/api/notifications/*/read', async (route) => {
      currentUnreadCount = Math.max(0, currentUnreadCount - 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // Navigate to app
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
  });

  // ... tests below
});
```

---

- [ ] **Test**: clicking notification should navigate without showing splash screen
  - **File**: `frontend/tests/notification-bell.spec.ts`
  - **Preconditions**: 
    - User is logged in (auth.json)
    - User has push notifications subscribed
    - At least one unread notification exists (mocked above)
  - **Steps**:
    ```typescript
    test('clicking notification should navigate without showing splash screen', async ({ page }) => {
      // 1. Verify we're on the clients page (splash already gone)
      await expect(page).toHaveURL(/\/clients/);
      
      // 2. Click notification bell
      await page.locator('[data-testid="notification-bell"]').click();
      
      // 3. Wait for popover to appear
      await expect(page.locator('[data-testid="notification-popover"]')).toBeVisible();
      
      // 4. Click on first unread notification
      await page.locator('[data-testid="notification-item-unread"]').first().click();
      
      // 5. Wait for navigation to complete
      await page.waitForURL(/\/(clients|employees|messages)/);
      
      // 6. CRITICAL: Verify splash screen did NOT appear during navigation
      // The splash screen image should NOT be visible at any point
      await expect(page.locator('img[alt="Splash"]')).not.toBeVisible();
      
      // 7. Verify we navigated to the notification URL
      await expect(page).toHaveURL('/clients/1');
    });
    ```

---

- [ ] **Test**: badge count should update after clicking unread notification
  - **File**: `frontend/tests/notification-bell.spec.ts`
  - **Preconditions**: 
    - User has exactly 2 unread notifications (mocked above)
  - **Steps**:
    ```typescript
    test('badge count should update after clicking unread notification', async ({ page }) => {
      // 1. Verify initial badge count is exactly 2
      const badge = page.locator('[data-testid="notification-badge"]');
      await expect(badge).toHaveText('2');
      
      // 2. Click notification bell
      await page.locator('[data-testid="notification-bell"]').click();
      
      // 3. Wait for popover
      await expect(page.locator('[data-testid="notification-popover"]')).toBeVisible();
      
      // 4. Click first unread notification
      await page.locator('[data-testid="notification-item-unread"]').first().click();
      
      // 5. Wait for navigation and badge update
      await page.waitForURL(/\/clients\/1/);
      
      // 6. Navigate back to trigger badge refresh (or wait for refetch)
      await page.goBack();
      await page.waitForLoadState('networkidle');
      
      // 7. Verify badge count decreased to 1
      await expect(badge).toHaveText('1');
    });
    ```

---

- [ ] **Test**: splash screen should still appear on initial PWA app launch (regression)
  - **File**: `frontend/tests/notification-bell.spec.ts`
  - **Preconditions**: 
    - Test runs in PWA standalone mode simulation
  - **Steps**:
    ```typescript
    test('splash screen should still appear on initial PWA app launch', async ({ browser }) => {
      // 1. Create new context with PWA simulation
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        // Clear storage to simulate fresh app launch
        storageState: undefined,
      });
      
      const page = await context.newPage();
      
      // 2. Inject display-mode: standalone media query match BEFORE navigation
      await page.addInitScript(() => {
        Object.defineProperty(window, 'matchMedia', {
          writable: true,
          value: (query: string) => ({
            matches: query === '(display-mode: standalone)',
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          }),
        });
      });
      
      // 3. Navigate to app root
      await page.goto('/');
      
      // 4. Splash should be visible initially (within first 500ms)
      await expect(page.locator('img[alt="Splash"]')).toBeVisible({ timeout: 500 });
      
      // 5. Splash should disappear after ~1.5-2 seconds
      await expect(page.locator('img[alt="Splash"]')).not.toBeVisible({ timeout: 3000 });
      
      // 6. Cleanup
      await context.close();
    });
    ```

---

- [ ] **Test**: popover should close immediately when notification is clicked
  - **File**: `frontend/tests/notification-bell.spec.ts`
  - **Steps**:
    ```typescript
    test('popover should close immediately when notification is clicked', async ({ page }) => {
      // 1. Click notification bell
      await page.locator('[data-testid="notification-bell"]').click();
      
      // 2. Wait for popover to appear
      const popover = page.locator('[data-testid="notification-popover"]');
      await expect(popover).toBeVisible();
      
      // 3. Click notification item
      await page.locator('[data-testid="notification-item-unread"]').first().click();
      
      // 4. Popover should close immediately (within 500ms, before navigation completes)
      await expect(popover).not.toBeVisible({ timeout: 500 });
      
      // 5. Navigation should still complete
      await expect(page).toHaveURL('/clients/1');
    });
    ```

---

### Optional Edge Case Tests (Future Enhancement)

These tests are documented for completeness but are **low priority** since the implementation plan accepts the current behavior for these scenarios.

- [ ] **Test (Optional)**: should navigate even when markAsRead.mutate fails
  - **Rationale**: Implementation plan states "Mutation failure: Navigation should proceed regardless (fire-and-forget pattern)"
  - **Setup**: Mock `markAsRead.mutate` to throw error
  - **Expected**: `router.push` still called, error handled gracefully

- [ ] **Test (Optional)**: should handle rapid clicks without errors
  - **Rationale**: Implementation plan states "Rapid clicks: Multiple mutations are idempotent, multiple navigations to same URL are harmless"
  - **Setup**: Click same notification 3 times rapidly (< 100ms between)
  - **Expected**: Multiple mutations fire, multiple router.push calls (harmless)

---

## Phase 2: GREEN (Implement to Pass)

> **Goal**: Write minimum code to make all tests pass

### Implementation Tasks (from notification-bell-fixes.md)

- [ ] 1. **Add useRouter import and hook**
  - **File**: `frontend/src/app/(components)/notifications/NotificationBell.tsx`
  - **Tests to Pass**: All router.push tests
  - **References**: Lines 1-30 (imports section)

- [ ] 2. **Replace window.location.href with router.push()**
  - **File**: `frontend/src/app/(components)/notifications/NotificationBell.tsx`
  - **Tests to Pass**: 
    - "should call router.push with notification URL"
    - "should NOT call window.location.href"
    - "clicking notification should navigate without showing splash screen"
  - **References**: Lines 119-128 (handleNotificationClick)

- [ ] 3. **Reorder popover close timing**
  - **File**: `frontend/src/app/(components)/notifications/NotificationBell.tsx`
  - **Tests to Pass**: "should close popover before navigation"
  - **References**: Lines 115-128

- [ ] 4. **Add data-testid attributes**
  - **File**: `frontend/src/app/(components)/notifications/NotificationBell.tsx`
  - **Tests to Pass**: All E2E tests (selector reliability)
  - **Required testids**:
    - `notification-bell` on IconButton
    - `notification-badge` on Badge
    - `notification-popover` on Popover
    - `notification-item` on each ListItem
    - `notification-item-unread` conditionally when `!notification.isRead`

---

## Phase 3: REFACTOR (Keep Tests Green)

> **Goal**: Improve code quality while maintaining passing tests

- [ ] Ensure consistent error handling in handleNotificationClick
- [ ] Add TypeScript strict null checks for notification.data?.url
- [ ] Consider extracting navigation logic to a custom hook (future improvement)

**Verification**: After each refactor step, run:
- `npm test -- NotificationBell` (unit tests)
- `npx playwright test notification-bell` (E2E tests)

---

## Test Data Setup

### Mock Notification Objects (for Unit Tests)

```typescript
// frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx

import { Notification } from '@/app/hooks/usePushNotification';

const mockUnreadNotificationWithUrl: Notification = {
  id: 1,
  title: "새 메시지가 도착했습니다",
  body: "홍길동님이 메시지를 보냈습니다",
  data: { url: "/clients/123" },
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};

const mockReadNotificationWithUrl: Notification = {
  id: 2,
  title: "읽은 알림",
  body: "이미 확인한 알림입니다",
  data: { url: "/employees/456" },
  sentAt: new Date().toISOString(),
  readAt: new Date().toISOString(),
  isRead: true,
};

const mockNotificationWithoutUrl: Notification = {
  id: 3,
  title: "URL 없는 알림",
  body: "이동할 페이지가 없습니다",
  data: null,
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};

const mockNotificationWithDataButNoUrl: Notification = {
  id: 4,
  title: "Data without URL",
  body: "Has data object but no url property",
  data: { otherProp: 'value' },
  sentAt: new Date().toISOString(),
  readAt: null,
  isRead: false,
};
```

---

## Verification Commands

### Unit Tests
```bash
# Run NotificationBell unit tests
cd frontend
npm test -- --testPathPattern="NotificationBell"

# Run with coverage
npm test -- --testPathPattern="NotificationBell" --coverage
```

### E2E Tests
```bash
# Run notification bell E2E tests
cd frontend
npx playwright test notification-bell.spec.ts

# Run with browser visible
npx playwright test notification-bell.spec.ts --headed

# Run specific test
npx playwright test notification-bell.spec.ts -g "should navigate without showing splash"
```

---

## Success Criteria

### RED Phase Complete When:
- [ ] Unit test file created at `frontend/src/app/(components)/notifications/__tests__/NotificationBell.test.tsx`
- [ ] E2E test file created at `frontend/tests/notification-bell.spec.ts`
- [ ] `npm test -- NotificationBell` runs (and FAILS as expected - router.push not implemented yet)
- [ ] `npx playwright test notification-bell` runs (and FAILS - data-testid not added yet)

### GREEN Phase Complete When:
- [ ] `npm test -- NotificationBell` → 100% pass
- [ ] `npx playwright test notification-bell` → 100% pass
- [ ] Badge count updates correctly after clicking unread notifications
- [ ] No splash screen appears during in-app navigation
- [ ] Splash screen still appears on initial PWA app launch

### REFACTOR Phase Complete When:
- [ ] Code quality improved (if needed)
- [ ] All tests still pass
- [ ] No regressions introduced
- [ ] TypeScript compiles without errors

---

## Notes

### Test Dependencies
- **Jest**: Already configured in Next.js
- **Playwright**: Already configured (`frontend/playwright.config.ts`)
- **React Testing Library**: Verify installation with `npm ls @testing-library/react`
  - If not installed: `npm install --save-dev @testing-library/react @testing-library/jest-dom`

### Known Limitations
1. **PWA Mode Simulation**: Playwright can simulate `display-mode: standalone` via `matchMedia` mock, but actual PWA behavior may differ on real devices
2. **Splash Screen Timing**: The 1.5s splash duration is hardcoded; tests should account for animation time (use 3000ms timeout)
3. **Auth State**: E2E tests require valid `auth.json` for authenticated routes

### Thomas Review Applied
- [x] Added explicit component rendering steps to all unit tests
- [x] Chose DOM query approach for popover close assertion (not "Or")
- [x] Specified exact initial badge count (2) in E2E tests with deterministic mocks
- [x] Clarified PWA context setup (in individual test, with cleanup)
- [x] Added edge case test for `notification.data` without `url` property
- [x] Added regression test comment explaining why we test `window.location.href`
- [x] Documented optional edge case tests (mutation failure, rapid clicks)
