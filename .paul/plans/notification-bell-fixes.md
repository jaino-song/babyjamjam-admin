# Notification Bell Bug Fixes

## Context

### Original Request
The notification bell button on the header has two issues:
1. The badge count is not accurate - it doesn't update when viewing/clicking notifications
2. Clicking a notification item shows the splash screen, which should only appear at app launch

### Interview Summary
**Key Discussions**:
- Badge should update when user CLICKS on a notification item (mark as read on click)
- Use Next.js router for client-side navigation instead of full page reload
- Splash screen should ONLY appear at PWA app launch, not on in-app navigation

**Research Findings**:
- **Root Cause Identified**: Both issues stem from `window.location.href` causing full page reload
- The `markAsRead.mutate()` is already called on click, but the page reloads before the mutation completes
- Full page reload resets splash screen's `minTimeElapsed` state, triggering the 1.5s splash again
- Solution: Replace `window.location.href` with `router.push()` for client-side navigation

---

## Work Objectives

### Core Objective
Fix the notification bell component to properly update badge count on item click and prevent splash screen from appearing during in-app navigation.

### Concrete Deliverables
- Modified `NotificationBell.tsx` with Next.js router navigation
- Badge count updates correctly after clicking notification items
- Splash screen only appears at app launch (PWA mode)

### Definition of Done
- [ ] Clicking a notification item marks it as read AND updates the badge count
- [ ] Clicking a notification item navigates without showing splash screen
- [ ] Splash screen still appears on initial PWA app launch
- [ ] All existing notification functionality remains intact

### Must Have
- Use Next.js `useRouter` hook for navigation
- Maintain existing mark-as-read functionality
- Keep popover close behavior after navigation

### Must NOT Have (Guardrails)
- Do NOT modify the SplashScreen component
- Do NOT change the backend API
- Do NOT change the mark-as-read mutation logic
- Do NOT add unnecessary dependencies

### Edge Cases to Handle
- **Mutation failure**: Navigation should proceed regardless (fire-and-forget pattern is acceptable - TanStack Query will retry and sync state)
- **Invalid URL**: router.push to invalid route shows Next.js 404 page (acceptable)
- **Rapid clicks**: Current pattern is acceptable - multiple mutations are idempotent, multiple navigations to same URL are harmless

---

## Task Flow

```
Task 1: Add useRouter import and hook
         ↓
Task 2: Replace window.location.href with router.push()
         ↓
Task 3: Handle popover close timing
         ↓
Task 4: Add data-testid attributes for E2E testing
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| Sequential | 1 → 2 → 3 | Each task depends on the previous |
| Parallel | 4 | Can be done independently after Task 1 |

| Task | Depends On | Reason |
|------|------------|--------|
| 2 | 1 | Needs router instance from useRouter |
| 3 | 2 | Needs to verify navigation behavior |
| 4 | 1 | Independent but logically after core implementation |

---

## TODOs

- [ ] 1. Add Next.js useRouter hook to NotificationBell component

  **What to do**:
  - Import `useRouter` from `next/navigation`
  - Initialize router instance inside the component: `const router = useRouter();`
  - Place the hook call at the top of the component with other hooks

  **Must NOT do**:
  - Do NOT use `useRouter` from `next/router` (that's Pages Router, not App Router)
  - Do NOT conditionally call the hook

  **Parallelizable**: NO (first task)

  **References**:
  - `frontend/src/app/(components)/notifications/NotificationBell.tsx:1-30` - Current imports section
  - Next.js App Router documentation for `useRouter`

  **Acceptance Criteria**:
  - [ ] `useRouter` is imported from `next/navigation`
  - [ ] `router` instance is available in the component

---

- [ ] 2. Replace window.location.href with router.push()

  **What to do**:
  - In `handleNotificationClick` function, replace:
    ```typescript
    window.location.href = notification.data.url as string;
    ```
    with:
    ```typescript
    router.push(notification.data.url as string);
    ```
  - This enables client-side navigation without full page reload

  **Must NOT do**:
  - Do NOT remove the `if (notification.data?.url)` check
  - Do NOT change the `markAsRead.mutate()` call
  - Do NOT use `router.replace()` (we want browser history)

  **Parallelizable**: NO (depends on Task 1)

  **References**:
  - `frontend/src/app/(components)/notifications/NotificationBell.tsx:119-128` - handleNotificationClick function

  **Acceptance Criteria**:
  - [ ] `router.push()` is used instead of `window.location.href`
  - [ ] Navigation happens without page reload
  - [ ] Mutation completes and badge count updates

---

- [ ] 3. Reorder popover close timing with client-side navigation

  **What to do**:
  - Ensure `handleClose()` is called BEFORE `router.push()` to close popover before navigation
  - Current order: markAsRead → navigate → handleClose
  - New order should be: markAsRead → handleClose → navigate
  - This prevents the popover from briefly showing during navigation

  **Rationale for order**:
  - `markAsRead.mutate()` is fire-and-forget (async, non-blocking) - no need to wait
  - `handleClose()` must run BEFORE navigation because router.push triggers React re-render
  - If popover is still open during navigation, it may flash briefly before the new page renders
  - This order: mutation fires → popover closes immediately → navigation begins

  **Implementation**:
  ```typescript
  const handleNotificationClick = (notification: Notification) => {
      if (!notification.isRead) {
          markAsRead.mutate(notification.id);
      }
      handleClose(); // Close popover first
      if (notification.data?.url) {
          router.push(notification.data.url as string);
      }
  };
  ```

  **Must NOT do**:
  - Do NOT remove the handleClose() call entirely
  - Do NOT make navigation async/await (mutation is fire-and-forget, which is fine)

  **Parallelizable**: NO (depends on Task 2)

  **References**:
  - `frontend/src/app/(components)/notifications/NotificationBell.tsx:119-128` - handleNotificationClick function
  - `frontend/src/app/(components)/notifications/NotificationBell.tsx:115-117` - handleClose function

  **Acceptance Criteria**:
  - [ ] Popover closes immediately when notification is clicked
  - [ ] Navigation occurs after popover is closed
  - [ ] No visual glitch with popover during navigation

---

- [ ] 4. Add data-testid attributes for E2E testing

  **What to do**:
  - Add `data-testid` attributes to key elements for reliable E2E test selectors
  - Required attributes:
    - `data-testid="notification-bell"` on the IconButton
    - `data-testid="notification-badge"` on the Badge component
    - `data-testid="notification-popover"` on the Popover
    - `data-testid="notification-item"` on each ListItem
    - Add `data-testid="notification-item-unread"` conditionally when `!notification.isRead`

  **Implementation**:
  ```tsx
  <IconButton
      onClick={handleClick}
      disabled={isLoading}
      color="inherit"
      data-testid="notification-bell"
  >
      {/* ... */}
      <Badge badgeContent={unreadCount} color="error" data-testid="notification-badge">
  
  <ListItem
      key={notification.id}
      onClick={() => handleNotificationClick(notification)}
      data-testid={`notification-item${!notification.isRead ? '-unread' : ''}`}
  ```

  **Must NOT do**:
  - Do NOT change any existing functionality
  - Do NOT add testids to elements that don't need testing

  **Parallelizable**: YES (independent of Tasks 2-3)

  **References**:
  - `frontend/src/app/(components)/notifications/NotificationBell.tsx:301-323` - IconButton and Badge
  - `frontend/src/app/(components)/notifications/NotificationBell.tsx:244-288` - ListItem

  **Acceptance Criteria**:
  - [ ] All key elements have `data-testid` attributes
  - [ ] E2E tests can reliably select notification components
  - [ ] Existing functionality unchanged

---

## Success Criteria

### Final Checklist
- [ ] All "Must Have" requirements are implemented
- [ ] All "Must NOT Have" guardrails are respected
- [ ] Badge count updates correctly when clicking unread notifications
- [ ] No splash screen appears when clicking notification items
- [ ] Splash screen still works correctly on initial PWA app launch
- [ ] Existing notification features (list, mark all as read, subscription) still work
- [ ] TypeScript compiles without errors
- [ ] No console errors during navigation
- [ ] All data-testid attributes are in place for E2E testing

---

## Notes

### Test Specifications
Test specifications (unit tests, E2E tests) will be created separately by Solomon (TDD Planner).
This plan focuses on implementation tasks only.

### Thomas Review Applied
- Added Task 4 for data-testid attributes (enables E2E testing)
- Acceptance criteria focus on observable behavior, not implementation details

### Momus Review Applied
- Added edge case handling section (mutation failure, invalid URL, rapid clicks)
- Added rationale for execution order in Task 3
- Verified codebase for other `window.location.href` usages:
  - `login/page.tsx`: OAuth redirects to external providers (INTENTIONAL - must be full page redirect)
  - `NotificationBell.tsx`: Internal navigation (BUG - this plan fixes it)
  - No other instances need fixing
