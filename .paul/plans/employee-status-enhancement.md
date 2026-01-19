# Employee Status Enhancement

## Context

### Original Request
Implement the "배당된 고객" column functionality in the employees page, which evolved into a comprehensive employee status enhancement.

### Interview Summary
**Key Discussions**:
- Column "배당된 고객" (assigned customers) → Replace with "연락처" (phone number)
- Column "근무 가능" → Rename to "상태" with 3-state derived logic
- Status priority: `openToNextWork = false` ALWAYS shows "근무 불가"
- Schedule check: Both primary AND secondary employee assignments count
- Toggle: Add Switch in EmployeeDetailModal for quick availability toggle

**Research Findings**:
- Database: `employee_schedule` table links employees to clients via `primary_employee_id` and `secondary_employee_id`
- Schedule fields: `start_date`, `end_date`, `replaced` boolean
- Current status: Binary (available/unavailable) based on `openToNextWork` only
- Frontend uses `getStatusChip()` function in EmployeesTable.tsx (lines 28-33)

**Business Logic Clarifications**:
- `replaced = true` means the schedule was superseded/cancelled → exclude from active check
- If employee is BOTH primary on one schedule AND secondary on another → show "근무 중" (any active schedule counts)
- Date comparison uses Korea Standard Time (KST, UTC+9)

---

## Work Objectives

### Core Objective
Transform the employee status display from a simple boolean to a derived 3-state status based on availability property AND active schedule assignments.

### Concrete Deliverables
- Modified `GET /employees` API response with `status` field
- Updated EmployeesTable with 3-state status chips and phone column
- Toggle Switch in EmployeeDetailModal for availability
- Updated translations (ko.json, en.json)

### Definition of Done
- [ ] Employee list displays 3 status states with correct colors
- [ ] Phone number displays in the third column
- [ ] Toggle in EmployeeDetailModal changes availability
- [ ] Status correctly reflects schedule assignments (primary OR secondary)
- [ ] All existing tests pass + new tests for status logic

### Must Have
- 3-state status: 근무 가능 (green), 근무 중 (orange/warning), 근무 불가 (gray)
- Status priority (explicit):
  1. If `openToNextWork = false` → "근무 불가" (ALWAYS wins, regardless of schedule)
  2. Else if has active schedule (primary OR secondary) → "근무 중"
  3. Else → "근무 가능"
- Schedule check includes both primary and secondary employee roles
- Exclude `replaced = true` schedules from active check
- Switch toggle in EmployeeDetailModal

### Must NOT Have (Guardrails)
- DO NOT modify database schema (use existing `employee_schedule` table)
- DO NOT add filtering/sorting by status (not requested)
- DO NOT create new API endpoints (extend existing `GET /employees`)
- DO NOT add customer count display (replaced by phone number)
- DO NOT add automatic status transitions (toggle is manual only)

---

## Task Flow

```
Task 1 (Backend Types/DTO) 
    ↓
Task 2 (Backend Repository - modify findAll) 
    ↓
Task 3 (Backend Service - modify existing use case)
    ↓
Task 4 (Frontend Types)
    ↓
Task 5 (Frontend Table) ←──┐
                           │ (parallel)
Task 6 (Frontend Modal) ←──┘
    ↓
Task 7 (Translations)
    ↓
Task 8 (Tests)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 5, 6 | Can run in parallel once types are updated (after Task 4) |

| Task | Depends On | Reason |
|------|------------|--------|
| 2 | 1 | Repository uses new status type |
| 3 | 2 | Service uses updated repository method |
| 4 | 3 | Frontend types must match API response |
| 5, 6 | 4 | Components use updated Employee type |
| 7 | 5, 6 | Translations needed for new status labels |
| 8 | 1-7 | Tests cover all implementation |

---

## TODOs

### Task 1: Create Backend Status Type and DTO

**What to do**:
- Create `EmployeeStatus` type in `backend/domain/entities/employee.entity.ts`:
  ```typescript
  export type EmployeeStatus = 'available' | 'working' | 'unavailable';
  ```
- Add optional `status?: EmployeeStatus` property to `EmployeeEntity` class (computed, not persisted)
- Update response mapping to include `status` field

**Must NOT do**:
- Do not add status to database schema
- Do not add status calculation logic to entity (repository computes it)

**Parallelizable**: NO (foundation task)

**References**:
- `backend/domain/entities/employee.entity.ts` - Add type and optional property here
- `backend/interface/dto/employee.dto.ts` - Reference for DTO patterns

**Acceptance Criteria**:
- [ ] `EmployeeStatus` type exported from entity file
- [ ] `EmployeeEntity` has optional `status?: EmployeeStatus` property
- [ ] Type is importable by repository and service layers

---

### Task 2: Modify Backend Repository findAll Method

**What to do**:
- MODIFY existing `findAll()` method in `IEmployeeRepository` interface to return employees with status
- Update `SbEmployeeRepository.findAll()` implementation:
  - Query employees with LEFT JOIN on `employee_schedule`
  - Check for active schedules: `start_date <= today <= end_date` (using KST timezone)
  - Check both `primary_employee_id` AND `secondary_employee_id`
  - Exclude schedules where `replaced = true`
  - Compute status for each employee and set on entity
- Use Prisma's efficient single query (avoid N+1)

**Must NOT do**:
- Do not create new repository method (modify existing `findAll`)
- Do not use multiple sequential queries

**Parallelizable**: NO (depends on Task 1)

**References**:
- `backend/domain/repositories/employee.repository.interface.ts:8` - `findAll()` method
- `backend/infrastructure/database/repositories/sb.employee.repository.ts:49-52` - Current implementation
- `backend/prisma/schema.prisma:78-102` - Employee and employee_schedule models

**Acceptance Criteria**:
- [ ] `findAll()` returns employees with `status` field populated
- [ ] Single efficient Prisma query (no N+1)
- [ ] Status computed correctly for all 3 states
- [ ] Active schedule check includes both primary and secondary roles
- [ ] Replaced schedules (`replaced = true`) excluded
- [ ] Handles null `start_date`/`end_date` gracefully (treat as no active schedule)
- [ ] Handles employees with no schedules (status = available if openToNextWork)
- [ ] Handles employees with multiple active schedules (still shows "working")

**Implementation Pattern**:
```typescript
async findAll(): Promise<EmployeeEntity[]> {
  // Use KST timezone for date comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const employees = await this.prismaService.employee.findMany({
    include: {
      employee_schedule_employee_schedule_primary_employee_idToemployee: {
        where: {
          start_date: { lte: today },
          end_date: { gte: today },
          replaced: false,
        },
        take: 1, // Only need to know if at least one exists
      },
      employee_schedule_employee_schedule_secondary_employee_idToemployee: {
        where: {
          start_date: { lte: today },
          end_date: { gte: today },
          replaced: false,
        },
        take: 1,
      },
    },
  });
  
  return employees.map((emp) => {
    const entity = EmployeeMapper.toDomain(emp);
    
    // Compute status
    if (!entity.openToNextWork) {
      entity.status = 'unavailable';
    } else {
      const hasPrimarySchedule = emp.employee_schedule_employee_schedule_primary_employee_idToemployee.length > 0;
      const hasSecondarySchedule = emp.employee_schedule_employee_schedule_secondary_employee_idToemployee.length > 0;
      entity.status = (hasPrimarySchedule || hasSecondarySchedule) ? 'working' : 'available';
    }
    
    return entity;
  });
}
```

---

### Task 3: Update Backend Service (Modify Existing Use Case)

**What to do**:
- MODIFY existing `ListEmployeesUsecase` to use updated repository method
- `EmployeeService.findAll()` automatically gets status from repository (no change needed)
- Controller endpoint `GET /employees` remains unchanged
- API response now includes `status` field (backward compatible - adding field)

**Must NOT do**:
- Do not create new use case (modify existing)
- Do not create new endpoint
- Do not break existing API contract

**Parallelizable**: NO (depends on Task 2)

**References**:
- `backend/application/usecases/employee/list-employees.usecase.ts` - Existing use case
- `backend/application/services/employee.service.ts:66-68` - Service method
- `backend/interface/controllers/employee.controller.ts:19-22` - Controller

**Acceptance Criteria**:
- [ ] `GET /employees` returns `status` field for each employee
- [ ] Backward compatible (all existing fields still present)
- [ ] No changes needed to controller (status flows through automatically)

---

### Task 4: Update Frontend Employee Types

**What to do**:
- Add `EmployeeStatus` type to `frontend/src/features/employees/types/index.ts`:
  ```typescript
  export type EmployeeStatus = 'available' | 'working' | 'unavailable';
  ```
- Add `status: EmployeeStatus` field to `Employee` interface
- Keep `openToNextWork` for toggle functionality

**Must NOT do**:
- Do not remove existing properties

**Parallelizable**: NO (depends on Task 3)

**References**:
- `frontend/src/features/employees/types/index.ts:3-11` - Current Employee type

**Acceptance Criteria**:
- [ ] `EmployeeStatus` type exported
- [ ] `Employee` interface includes `status: EmployeeStatus` field
- [ ] TypeScript compilation passes

---

### Task 5: Update EmployeesTable Component

**What to do**:
- Update column header translation key usage: use existing `employees.table.open-status` (will be "상태")
- Replace third column: use `employees.table.contact` for "연락처" header (new key)
- Update `getStatusChip()` function to handle 3 states based on `employee.status`:
  - `'unavailable'`: gray chip (color="default"), label from `employees.status.unavailable`
  - `'working'`: orange chip (color="warning"), label from `employees.status.working`
  - `'available'`: green chip (color="success"), label from `employees.status.available`
- Display formatted phone number in third column
- Create `formatPhoneNumber` utility or reuse from EmployeeDetailModal:
  ```typescript
  const formatPhoneNumber = (phone: string | null | undefined): string => {
    if (!phone) return "-";
    const numbers = phone.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
  };
  ```

**Must NOT do**:
- Do not change table structure beyond column content
- Do not add new columns
- Do not hardcode translation strings

**Parallelizable**: YES (with Task 6 after Task 4)

**References**:
- `frontend/src/features/employees/components/EmployeesTable.tsx:28-33` - Current getStatusChip
- `frontend/src/features/employees/components/EmployeesTable.tsx:186-210` - Table columns
- `frontend/src/features/employees/components/EmployeeDetailModal.tsx:33-39` - formatPhoneNumber reference

**Acceptance Criteria**:
- [ ] Column headers show "상태" and "연락처"
- [ ] 3 status chips display with correct colors (gray/orange/green)
- [ ] Phone number formatted correctly (XXX-XXXX-XXXX) or shows "-" if null
- [ ] Status derived from `employee.status` field (not computed on frontend)

---

### Task 6: Add Toggle to EmployeeDetailModal

**What to do**:
- Import `Switch` and `FormControlLabel` from MUI
- Import `useToggleEmployeeOpenStatus` hook
- Add Switch component in Work Info section (replace the current static Chip display at line 121-124)
- Implement toggle handler that calls mutation
- Show loading state while mutation is pending
- Invalidate query on success (handled by existing hook)

**Must NOT do**:
- Do not add confirmation dialog
- Do not modify other parts of the modal

**Parallelizable**: YES (with Task 5 after Task 4)

**References**:
- `frontend/src/features/employees/components/EmployeeDetailModal.tsx:121-124` - Current status display
- `frontend/src/features/employees/hooks/use-employees.ts:65-75` - useToggleEmployeeOpenStatus hook

**Acceptance Criteria**:
- [ ] Switch component visible in detail modal Work Info section
- [ ] Toggle immediately calls API to update `openToNextWork`
- [ ] Loading state shown during mutation (Switch disabled)
- [ ] UI refreshes after toggle (query invalidation)
- [ ] Uses existing mutation hook (no new API calls)

**Implementation Pattern**:
```tsx
// Add imports
import { Switch, FormControlLabel } from "@mui/material";
import { useToggleEmployeeOpenStatus } from "../hooks/use-employees";

// Inside component, before return:
const toggleStatus = useToggleEmployeeOpenStatus();

const handleToggle = () => {
  if (!employee) return;
  toggleStatus.mutate({ 
    id: employee.id, 
    openToNextWork: !employee.openToNextWork 
  });
};

// Replace the existing InfoRow for open-to-next-work (line 121-124):
<InfoRow
  label={t(locale, "employees.form.open-to-next-work")}
  value={
    <FormControlLabel
      control={
        <Switch
          checked={employee.openToNextWork}
          onChange={handleToggle}
          disabled={toggleStatus.isPending}
        />
      }
      label={
        toggleStatus.isPending 
          ? "..." 
          : (employee.openToNextWork 
              ? t(locale, "employees.status.available") 
              : t(locale, "employees.status.unavailable"))
      }
    />
  }
/>
```

---

### Task 7: Update Translation Files

**What to do**:
- Update `frontend/src/texts/ko.json`:
  - Change `employees.table.open-status`: "근무 가능" → "상태"
  - Add `employees.table.contact`: "연락처"
  - Add `employees.status.working`: "근무 중"
  - Update `employees.status.available`: "근무 가능" (was "가능")
  - Update `employees.status.unavailable`: "근무 불가" (was "불가능")
- Update `frontend/src/texts/en.json`:
  - Change `employees.table.open-status`: → "Status"
  - Add `employees.table.contact`: "Contact"
  - Add `employees.status.working`: "Working"
  - Update `employees.status.available`: "Available"
  - Update `employees.status.unavailable`: "Unavailable"

**Must NOT do**:
- Do not delete any existing keys (may be used elsewhere)

**Parallelizable**: NO (depends on Tasks 5, 6)

**References**:
- `frontend/src/texts/ko.json:294-302` - Current employee translations
- `frontend/src/texts/en.json` - English translations

**Acceptance Criteria**:
- [ ] All 3 status labels exist in both languages
- [ ] Column headers use correct translation keys
- [ ] No hardcoded strings in components
- [ ] Status labels are full words (근무 가능, 근무 중, 근무 불가)

---

### Task 8: Write Tests

**What to do**:
- **Backend Repository Tests** (`backend/test/repositories/sb.employee.repository.spec.ts`):
  - Test status = 'unavailable' when `openToNextWork = false`
  - Test status = 'working' when has active primary schedule
  - Test status = 'working' when has active secondary schedule
  - Test status = 'available' when `openToNextWork = true` and no active schedules
  - Test replaced schedules are excluded
  - Test null date handling
  - Test employee with multiple active schedules

- **Backend Use Case Tests** (`backend/test/usecases/employee/list-employees.usecase.spec.ts`):
  - Verify status field is included in returned entities

- **Frontend Component Tests** (optional but recommended):
  - Test `getStatusChip()` renders correct colors for each status
  - Test toggle mutation is called on Switch change

**Must NOT do**:
- Do not skip edge case tests
- Do not use any/unknown types in test mocks

**Parallelizable**: NO (depends on all implementation tasks)

**References**:
- `backend/test/repositories/sb.employee.repository.spec.ts` - Existing test patterns
- `backend/test/usecases/employee/` - Use case test patterns

**Acceptance Criteria**:
- [ ] All 3 status states have dedicated test cases
- [ ] Edge cases covered (null dates, replaced schedules, multiple schedules)
- [ ] Existing tests still pass
- [ ] Test coverage maintained or improved

---

## Success Criteria

### Final Checklist
- [ ] All "Must Have" requirements implemented
- [ ] All "Must NOT Have" guardrails respected
- [ ] 3-state status displays correctly in employee table
- [ ] Phone number shows in third column (formatted or "-")
- [ ] Toggle in EmployeeDetailModal works with loading state
- [ ] Translations complete for ko/en (both languages, all 3 statuses)
- [ ] No TypeScript errors
- [ ] Existing functionality preserved
- [ ] Backend API backward compatible (only adds fields)
- [ ] All tests pass (existing + new)
