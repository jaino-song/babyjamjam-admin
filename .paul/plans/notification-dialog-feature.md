# Implementation Plan: Notification Click Dialog

## Overview
Change notification click behavior from page navigation to showing a dialog with filtered clients table. Also fix backend query to exclude already-started services.

## Success Criteria
- [ ] Clicking filtered notification shows dialog instead of navigating
- [ ] Dialog displays same table as `/clients/filtered` page
- [ ] Clicking row in dialog opens ClientDetailModal
- [ ] Edit/Delete functionality works from dialog
- [ ] "Starting-soon" related filters exclude clients already in service
- [ ] `/clients/filtered` page still works for direct URL access

---

## Tasks

### Phase 1: Backend Fix (Query Logic)
**Parallelizable**: NO (single file, must be done atomically)

- [ ] **Task 1**: Fix `findStartingWithinDays` query in `sb.client.repository.ts`
  - Change `gte: today` to `gt: today` on line ~136
  - This ensures only clients starting AFTER today are included
  - File: `backend/infrastructure/database/repositories/sb.client.repository.ts`

- [ ] **Task 2**: Fix `findWithIncompleteContractsStartingWithinDays` query
  - Change `gte: today` to `gt: today` on line ~174
  - Same file as Task 1

- [ ] **Task 3**: Fix `findWithoutContractSentStartingWithinDays` query
  - Change `gte: today` to `gt: today` on line ~200
  - Same file as Task 1

### Phase 2: Frontend - Create Dialog Component
**Parallelizable**: YES (independent of Phase 1)

- [ ] **Task 4**: Create `FilteredClientsDialog` component
  - File: `frontend/src/app/(components)/notifications/FilteredClientsDialog.tsx`
  - Props:
    - `open: boolean`
    - `onClose: () => void`
    - `filterType: "starting-soon" | "ending-soon" | "incomplete-contracts" | "no-contract" | null`
    - `clientId?: number` (for individual client from no-contract notification)
  - Reuse:
    - `useFilteredClients` hook for data fetching
    - Table UI pattern from `filtered/page.tsx`
    - `ClientDetailModal` for row click
    - `ClientFormDialog` for editing
  - Features:
    - Show loading spinner while fetching
    - Show "no results" message if empty
    - Dialog title based on filter type (use FILTER_CONFIG from filtered/page.tsx)
    - Close button in header

### Phase 3: Frontend - Integrate Dialog into NotificationBell
**Parallelizable**: NO (depends on Task 4)

- [ ] **Task 5**: Add dialog state and handler to `NotificationBell.tsx`
  - Add state: `dialogOpen`, `dialogFilter`, `dialogClientId`
  - Import `FilteredClientsDialog` component
  - File: `frontend/src/app/(components)/notifications/NotificationBell.tsx`

- [ ] **Task 6**: Modify `handleNotificationClick` to detect filtered URLs
  - Parse notification URL to detect:
    - `/clients/filtered?filter=*` → extract filter type
    - `/clients?id=*` → extract client ID
  - If filtered URL: open dialog instead of `router.push`
  - If other URL: keep existing navigation behavior
  - File: `frontend/src/app/(components)/notifications/NotificationBell.tsx`

- [ ] **Task 7**: Render `FilteredClientsDialog` in NotificationBell
  - Add dialog component with proper props
  - Handle close callback to reset state
  - File: `frontend/src/app/(components)/notifications/NotificationBell.tsx`

### Phase 4: Support Individual Client (no-contract)
**Parallelizable**: NO (depends on Task 4)

- [ ] **Task 8**: Add single client fetch support to dialog
  - When `clientId` prop is provided (no `filterType`):
    - Fetch single client using existing hook or create simple query
    - Display in same table format (single row)
  - File: `frontend/src/app/(components)/notifications/FilteredClientsDialog.tsx`

### Phase 5: Verification
**Parallelizable**: YES (after all implementation)

- [ ] **Task 9**: Verify backend fix
  - Check that starting-soon queries exclude today's clients
  - Test via API or Prisma Studio

- [ ] **Task 10**: Verify dialog functionality
  - Click notification → dialog opens
  - Table shows correct filtered data
  - Row click → detail modal opens
  - Edit/Delete works
  - Dialog closes properly

- [ ] **Task 11**: Verify existing page still works
  - Direct navigation to `/clients/filtered?filter=starting-soon` works
  - All filter types work

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `backend/.../sb.client.repository.ts` | MODIFY | Change `gte` to `gt` in 3 methods |
| `frontend/.../notifications/FilteredClientsDialog.tsx` | CREATE | New dialog component |
| `frontend/.../notifications/NotificationBell.tsx` | MODIFY | Add dialog state and URL detection |

---

## Technical Notes

### URL Parsing Logic (Task 6)
```typescript
const parseNotificationUrl = (url: string) => {
  // Check for filtered page URL
  const filteredMatch = url.match(/\/clients\/filtered\?filter=(.+)/);
  if (filteredMatch) {
    return { type: 'filter', filter: filteredMatch[1] };
  }
  
  // Check for individual client URL
  const clientMatch = url.match(/\/clients\?id=(\d+)/);
  if (clientMatch) {
    return { type: 'client', clientId: parseInt(clientMatch[1]) };
  }
  
  return null; // Not a filtered URL, use normal navigation
};
```

### Filter Types (from filtered/page.tsx)
```typescript
type FilterType = "starting-soon" | "ending-soon" | "incomplete-contracts" | "no-contract";

const FILTER_CONFIG: Record<FilterType, { title: string }> = {
    "starting-soon": { title: "7일 내 서비스 시작 예정" },
    "ending-soon": { title: "7일 내 서비스 종료 예정" },
    "incomplete-contracts": { title: "계약서 미완료" },
    "no-contract": { title: "계약서 미발송" },
};
```

---

## Dependencies
- `@mui/material` Dialog component (already in project)
- `useFilteredClients` hook (already exists)
- `ClientDetailModal` component (already exists)
- `ClientFormDialog` component (already exists)
