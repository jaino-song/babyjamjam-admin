# Draft: Notification Click Dialog Instead of Page Navigation

## Requirements (confirmed)
- Currently: Clicking filtered notification items routes to `/clients/filtered?filter=...` pages
- Desired: Show a dialog with the filtered clients table instead of navigating

## Technical Decisions
- Reuse existing table UI from `filtered/page.tsx` in a dialog component
- Keep `useFilteredClients` hook for data fetching
- Dialog will show the same table with name, start date, contract status

## Research Findings
- **NotificationBell.tsx**: Lines 121-130 handle click with `router.push(notification.data.url)`
- **filtered/page.tsx**: Has table + detail modal + edit form dialog already working
- **Notification types with filtered URLs**:
  - `starting-soon` → "서비스 시작 예정"
  - `ending-soon` → "서비스 종료 예정"
  - `incomplete-contracts` → "계약서 미완료"
  - `no-contract` → individual client URL (different pattern)

### Starting-soon Query Bug Analysis
- **File**: `sb.client.repository.ts`
- **Current query**: `start_date: { gte: today, lte: endDate }`
- **Problem**: Uses `gte` (>=) which includes clients starting TODAY (already in service)
- **Fix needed**: Change to `gt` (>) to only include clients starting AFTER today
- **Affected methods** (all use same pattern):
  1. `findStartingWithinDays` (line 125) - starting-soon filter
  2. `findWithIncompleteContractsStartingWithinDays` (line 163) - incomplete-contracts filter
  3. `findWithoutContractSentStartingWithinDays` (line 189) - no-contract filter

## Open Questions
- All resolved

## Confirmed Decisions
1. **Row Click**: Yes, clicking a row opens ClientDetailModal with view/edit/delete options
2. **Individual Clients**: Show dialog for ALL filtered notifications (including single client `no-contract`)
3. **Keep Page**: Keep `/clients/filtered` page for direct URL access (bookmarks, shared links)
4. **Starting-soon filter fix**: Only show clients whose service has NOT started yet (startDate > today). Currently in-service clients should be excluded.

## Scope Boundaries
- INCLUDE: 
  - New FilteredClientsDialog component
  - Modify NotificationBell click handler to show dialog instead of navigate
  - Support for all filter types (starting-soon, ending-soon, incomplete-contracts, no-contract)
  - Full functionality: row click → detail modal → edit/delete
  - **Backend fix**: Change `gte` to `gt` in 3 repository methods to exclude clients already in service
- EXCLUDE:
  - Removing `/clients/filtered` page (keep for direct access)

## Parallelization Opportunities
- Create FilteredClientsDialog component
- Modify NotificationBell click handler

## Dependencies
- Dialog must exist before modifying click handler
