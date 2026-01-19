# TDD Test Plan: Employee Status Enhancement

## Context

### Original Request
Implement 3-state employee status (available/working/unavailable) based on `openToNextWork` property AND active schedule assignments.

### Implementation Plan Reference
- Implementation plan: `.paul/plans/employee-status-enhancement.md`
- Status logic:
  1. If `openToNextWork = false` -> "unavailable" (ALWAYS wins)
  2. Else if has active schedule (primary OR secondary) -> "working"
  3. Else -> "available"

### Test Infrastructure
- **Backend Unit Tests**: Jest with existing patterns in `backend/test/`
- **Backend Integration Tests**: NestJS Testing Module with supertest
- **Frontend Component Tests**: Jest with existing patterns in `frontend/src/**/__tests__/`

---

## Test Strategy

### Unit Test Track (Jest)
- **Framework**: Jest
- **Pattern**: `backend/test/**/*.spec.ts`
- **Coverage Target**: 100% for status computation logic
- **Mocking Strategy**: Mock Prisma service for repository tests, Mock repository for use case tests

### Frontend Test Track (Jest)
- **Framework**: Jest
- **Pattern**: `frontend/src/**/__tests__/*.test.ts`
- **Focus**: Helper functions, status chip rendering logic

---

## Phase 1: RED (Write Failing Tests)

> **Goal**: Define the contract through failing tests

### 1.1 Backend Repository Tests - Status Computation

#### Test Suite: SbEmployeeRepository.findAll() with Status

- **File**: `backend/test/repositories/sb.employee.repository.spec.ts`
- **Location**: Add new describe block after existing `findAll` tests

---

- [ ] **Test**: should return status = 'unavailable' when openToNextWork is false (no schedules)
  - **Input**: Employee with `open_to_next_work: false`, no schedules
  - **Expected Output**: `EmployeeEntity` with `status: 'unavailable'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('unavailable');
    expect(result[0].openToNextWork).toBe(false);
    ```

---

- [ ] **Test**: should return status = 'unavailable' when openToNextWork is false (even with active schedules)
  - **Input**: Employee with `open_to_next_work: false`, has active primary schedule
  - **Expected Output**: `EmployeeEntity` with `status: 'unavailable'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('unavailable');
    // openToNextWork = false ALWAYS wins, regardless of schedule
    ```

---

- [ ] **Test**: should return status = 'working' when has active primary schedule
  - **Input**: Employee with `open_to_next_work: true`, has primary schedule where `start_date <= today <= end_date` and `replaced: false`
  - **Expected Output**: `EmployeeEntity` with `status: 'working'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('working');
    expect(result[0].openToNextWork).toBe(true);
    ```

---

- [ ] **Test**: should return status = 'working' when has active secondary schedule
  - **Input**: Employee with `open_to_next_work: true`, has secondary schedule where `start_date <= today <= end_date` and `replaced: false`
  - **Expected Output**: `EmployeeEntity` with `status: 'working'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('working');
    ```

---

- [ ] **Test**: should return status = 'working' when has both primary and secondary active schedules
  - **Input**: Employee with `open_to_next_work: true`, has both primary AND secondary active schedules
  - **Expected Output**: `EmployeeEntity` with `status: 'working'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('working');
    ```

---

- [ ] **Test**: should return status = 'available' when openToNextWork is true and no active schedules
  - **Input**: Employee with `open_to_next_work: true`, no schedules at all
  - **Expected Output**: `EmployeeEntity` with `status: 'available'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('available');
    expect(result[0].openToNextWork).toBe(true);
    ```

---

- [ ] **Test**: should exclude replaced schedules from active check
  - **Input**: Employee with `open_to_next_work: true`, has schedule with `replaced: true` (within date range)
  - **Expected Output**: `EmployeeEntity` with `status: 'available'` (replaced schedule doesn't count)
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('available');
    ```

---

- [ ] **Test**: should return status = 'available' when schedule is in the past
  - **Input**: Employee with `open_to_next_work: true`, has schedule where `end_date < today`
  - **Expected Output**: `EmployeeEntity` with `status: 'available'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('available');
    ```

---

- [ ] **Test**: should return status = 'available' when schedule is in the future
  - **Input**: Employee with `open_to_next_work: true`, has schedule where `start_date > today`
  - **Expected Output**: `EmployeeEntity` with `status: 'available'`
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('available');
    ```

---

- [ ] **Test**: should handle null start_date gracefully (treat as no active schedule)
  - **Input**: Employee with schedule where `start_date: null`
  - **Expected Output**: `EmployeeEntity` with `status: 'available'` (if openToNextWork is true)
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('available');
    ```

---

- [ ] **Test**: should handle null end_date gracefully (treat as no active schedule)
  - **Input**: Employee with schedule where `end_date: null`
  - **Expected Output**: `EmployeeEntity` with `status: 'available'` (if openToNextWork is true)
  - **Assertions**:
    ```typescript
    expect(result[0].status).toBe('available');
    ```

---

- [ ] **Test**: should compute status correctly for multiple employees with different states
  - **Input**: 
    - Employee 1: `openToNextWork: false` -> unavailable
    - Employee 2: `openToNextWork: true`, active schedule -> working
    - Employee 3: `openToNextWork: true`, no schedule -> available
  - **Expected Output**: Each employee has correct status
  - **Assertions**:
    ```typescript
    const unavailable = result.find(e => e.id === 1);
    const working = result.find(e => e.id === 2);
    const available = result.find(e => e.id === 3);
    expect(unavailable?.status).toBe('unavailable');
    expect(working?.status).toBe('working');
    expect(available?.status).toBe('available');
    ```

---

#### Mock Data Structure for Repository Tests

```typescript
// Add to createMockPrismaEmployee() or create new mock
const createEmployeeRowWithSchedules = (overrides = {}) => ({
  id: 1,
  name: "Alice",
  work_area: ["Incheon"],
  phone: "010-1234-5678",
  grade: "A",
  open_to_next_work: true,
  company_registered_date: new Date("2024-01-01T00:00:00.000Z"),
  employee_schedule_employee_schedule_primary_employee_idToemployee: [],
  employee_schedule_employee_schedule_secondary_employee_idToemployee: [],
  ...overrides,
});

const createActiveSchedule = (overrides = {}) => {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 7); // 7 days ago
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 7); // 7 days from now
  
  return {
    id: 1,
    start_date: startDate,
    end_date: endDate,
    replaced: false,
    ...overrides,
  };
};
```

---

### 1.2 Backend Use Case Tests - ListEmployeesUsecase

#### Test Suite: ListEmployeesUsecase with Status

- **File**: `backend/test/usecases/employee/list-employees.usecase.spec.ts`
- **Location**: Add new describe block for status field verification

---

- [ ] **Test**: should return employees with status field populated
  - **Input**: Repository returns employees with status
  - **Expected Output**: Use case returns same employees with status intact
  - **Assertions**:
    ```typescript
    expect(result[0]).toHaveProperty('status');
    expect(['available', 'working', 'unavailable']).toContain(result[0].status);
    ```

---

- [ ] **Test**: should preserve all existing employee fields along with new status field
  - **Input**: Employee with all fields + status
  - **Expected Output**: All fields present including status
  - **Assertions**:
    ```typescript
    expect(result[0]).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      workArea: expect.any(Array),
      phone: expect.any(String),
      grade: expect.any(String),
      openToNextWork: expect.any(Boolean),
      status: expect.stringMatching(/^(available|working|unavailable)$/),
    });
    ```

---

### 1.3 Backend Integration Tests - Employee Controller

#### Test Suite: GET /employees with Status

- **File**: `backend/test/integration/employee.controller.integration.spec.ts`
- **Location**: Add new describe block for status in response

---

- [ ] **Test**: should return status field in employee list response
  - **Input**: GET /employees
  - **Expected Output**: Response body contains employees with `status` field
  - **Assertions**:
    ```typescript
    expect(response.status).toBe(200);
    expect(response.body[0]).toHaveProperty('status');
    expect(['available', 'working', 'unavailable']).toContain(response.body[0].status);
    ```

---

- [ ] **Test**: should return all three status types correctly
  - **Input**: GET /employees (with mock data for all 3 statuses)
  - **Expected Output**: Response contains employees with different statuses
  - **Assertions**:
    ```typescript
    const statuses = response.body.map(e => e.status);
    expect(statuses).toContain('available');
    expect(statuses).toContain('working');
    expect(statuses).toContain('unavailable');
    ```

---

- [ ] **Test**: should maintain backward compatibility (all existing fields present)
  - **Input**: GET /employees
  - **Expected Output**: Response contains all existing fields + new status field
  - **Assertions**:
    ```typescript
    const employee = response.body[0];
    expect(employee).toHaveProperty('id');
    expect(employee).toHaveProperty('name');
    expect(employee).toHaveProperty('workArea');
    expect(employee).toHaveProperty('phone');
    expect(employee).toHaveProperty('grade');
    expect(employee).toHaveProperty('openToNextWork');
    expect(employee).toHaveProperty('status'); // NEW
    ```

---

### 1.4 Frontend Helper Tests - Status Chip Logic

#### Test Suite: getStatusChip Helper

- **File**: `frontend/src/features/employees/components/__tests__/EmployeesTable.helpers.test.ts` (NEW)

---

- [ ] **Test**: should return gray chip config for 'unavailable' status
  - **Input**: `status: 'unavailable'`
  - **Expected Output**: `{ color: 'default', label: 'employees.status.unavailable' }`
  - **Assertions**:
    ```typescript
    const result = getStatusChipConfig('unavailable');
    expect(result.color).toBe('default');
    expect(result.labelKey).toBe('employees.status.unavailable');
    ```

---

- [ ] **Test**: should return orange/warning chip config for 'working' status
  - **Input**: `status: 'working'`
  - **Expected Output**: `{ color: 'warning', label: 'employees.status.working' }`
  - **Assertions**:
    ```typescript
    const result = getStatusChipConfig('working');
    expect(result.color).toBe('warning');
    expect(result.labelKey).toBe('employees.status.working');
    ```

---

- [ ] **Test**: should return green/success chip config for 'available' status
  - **Input**: `status: 'available'`
  - **Expected Output**: `{ color: 'success', label: 'employees.status.available' }`
  - **Assertions**:
    ```typescript
    const result = getStatusChipConfig('available');
    expect(result.color).toBe('success');
    expect(result.labelKey).toBe('employees.status.available');
    ```

---

- [ ] **Test**: should handle undefined status gracefully (fallback to unavailable)
  - **Input**: `status: undefined`
  - **Expected Output**: `{ color: 'default', label: 'employees.status.unavailable' }`
  - **Assertions**:
    ```typescript
    const result = getStatusChipConfig(undefined);
    expect(result.color).toBe('default');
    ```

---

### 1.5 Frontend Helper Tests - Phone Number Formatting

#### Test Suite: formatPhoneNumber Helper

- **File**: `frontend/src/features/employees/components/__tests__/EmployeesTable.helpers.test.ts`
- **Note**: May reuse existing `formatPhoneNumber` from ClientFormDialog or create shared utility

---

- [ ] **Test**: should format 11-digit phone number correctly (010-XXXX-XXXX)
  - **Input**: `"01012345678"`
  - **Expected Output**: `"010-1234-5678"`
  - **Assertions**:
    ```typescript
    expect(formatPhoneNumber("01012345678")).toBe("010-1234-5678");
    ```

---

- [ ] **Test**: should return "-" for null phone number
  - **Input**: `null`
  - **Expected Output**: `"-"`
  - **Assertions**:
    ```typescript
    expect(formatPhoneNumber(null)).toBe("-");
    ```

---

- [ ] **Test**: should return "-" for undefined phone number
  - **Input**: `undefined`
  - **Expected Output**: `"-"`
  - **Assertions**:
    ```typescript
    expect(formatPhoneNumber(undefined)).toBe("-");
    ```

---

- [ ] **Test**: should return "-" for empty string phone number
  - **Input**: `""`
  - **Expected Output**: `"-"`
  - **Assertions**:
    ```typescript
    expect(formatPhoneNumber("")).toBe("-");
    ```

---

- [ ] **Test**: should handle already formatted phone numbers
  - **Input**: `"010-1234-5678"`
  - **Expected Output**: `"010-1234-5678"`
  - **Assertions**:
    ```typescript
    expect(formatPhoneNumber("010-1234-5678")).toBe("010-1234-5678");
    ```

---

## Phase 2: GREEN (Implement to Pass)

> **Goal**: Write minimum code to make all tests pass

### Backend Implementation Tasks

- [ ] 1. **Add EmployeeStatus type to entity**
  - **File**: `backend/domain/entities/employee.entity.ts`
  - **Tests to Pass**: Type compilation tests
  - **Implementation**:
    ```typescript
    export type EmployeeStatus = 'available' | 'working' | 'unavailable';
    ```

- [ ] 2. **Add status property to EmployeeEntity**
  - **File**: `backend/domain/entities/employee.entity.ts`
  - **Tests to Pass**: Entity property tests
  - **Implementation**: Add optional `status?: EmployeeStatus` property

- [ ] 3. **Modify SbEmployeeRepository.findAll() to compute status**
  - **File**: `backend/infrastructure/database/repositories/sb.employee.repository.ts`
  - **Tests to Pass**: All repository status computation tests (1.1)
  - **Key Logic**:
    - Include employee_schedule relations in query
    - Filter active schedules (start_date <= today <= end_date, replaced = false)
    - Compute status based on openToNextWork and active schedules

- [ ] 4. **Update EmployeeMapper if needed**
  - **File**: `backend/infrastructure/database/mapper/employee.mapper.ts`
  - **Tests to Pass**: Mapper tests (if any)

### Frontend Implementation Tasks

- [ ] 5. **Add EmployeeStatus type to frontend**
  - **File**: `frontend/src/features/employees/types/index.ts`
  - **Tests to Pass**: Type compilation

- [ ] 6. **Create getStatusChipConfig helper**
  - **File**: `frontend/src/features/employees/components/EmployeesTable.tsx` (or separate helper file)
  - **Tests to Pass**: All status chip tests (1.4)

- [ ] 7. **Create/reuse formatPhoneNumber helper**
  - **File**: `frontend/src/features/employees/components/EmployeesTable.tsx` (or shared utility)
  - **Tests to Pass**: All phone formatting tests (1.5)

- [ ] 8. **Update EmployeesTable component**
  - **File**: `frontend/src/features/employees/components/EmployeesTable.tsx`
  - **Tests to Pass**: Visual verification (manual)

- [ ] 9. **Update EmployeeDetailModal with toggle**
  - **File**: `frontend/src/features/employees/components/EmployeeDetailModal.tsx`
  - **Tests to Pass**: Toggle functionality tests

- [ ] 10. **Update translation files**
  - **Files**: `frontend/src/texts/ko.json`, `frontend/src/texts/en.json`
  - **Tests to Pass**: Translation key existence

---

## Phase 3: REFACTOR (Keep Tests Green)

> **Goal**: Improve code quality while maintaining passing tests

- [ ] Extract status computation logic to a separate utility function for testability
- [ ] Consider creating a shared `formatPhoneNumber` utility if not already exists
- [ ] Ensure consistent error handling for edge cases
- [ ] Add JSDoc comments for new types and functions
- [ ] Review and optimize Prisma query for performance

**Verification**: After each refactor step, run:
- `npm test` -> All unit tests pass
- `npm run test:e2e` -> All integration tests pass (if applicable)

---

## Verification Commands

### Backend Tests
```bash
# Run specific repository test file
cd backend && npm test -- --testPathPattern="sb.employee.repository.spec.ts"

# Run specific use case test file
cd backend && npm test -- --testPathPattern="list-employees.usecase.spec.ts"

# Run integration tests
cd backend && npm test -- --testPathPattern="employee.controller.integration.spec.ts"

# Run all employee-related tests
cd backend && npm test -- --testPathPattern="employee"

# Run with coverage
cd backend && npm test -- --coverage --collectCoverageFrom="**/employee*"
```

### Frontend Tests
```bash
# Run specific test file
cd frontend && npm test -- --testPathPattern="EmployeesTable.helpers.test.ts"

# Run all tests
cd frontend && npm test
```

---

## Success Criteria

### RED Phase Complete When:
- [ ] All test files created with failing tests
- [ ] `npm test` runs and shows expected failures
- [ ] Test structure follows existing patterns (AAA, Given-When-Then)

### GREEN Phase Complete When:
- [ ] `npm test` -> 100% pass for new tests
- [ ] All existing tests still pass (no regressions)
- [ ] Status computation logic works for all 3 states
- [ ] Edge cases handled (null dates, replaced schedules, multiple schedules)

### REFACTOR Phase Complete When:
- [ ] Code quality improved
- [ ] All tests still pass
- [ ] No code duplication
- [ ] Clear separation of concerns

---

## Test File Templates

### Backend Repository Test Template

```typescript
// backend/test/repositories/sb.employee.repository.spec.ts
// Add this describe block after existing findAll tests

describe("findAll with status computation", () => {
    // ============================================
    // Test Fixtures for Status Tests
    // ============================================
    
    const createEmployeeRowWithSchedules = (overrides = {}) => ({
        id: 1,
        name: "Alice",
        work_area: ["Incheon"],
        phone: "010-1234-5678",
        grade: "A",
        open_to_next_work: true,
        company_registered_date: new Date("2024-01-01T00:00:00.000Z"),
        employee_schedule_employee_schedule_primary_employee_idToemployee: [],
        employee_schedule_employee_schedule_secondary_employee_idToemployee: [],
        ...overrides,
    });

    const createActiveSchedule = (overrides = {}) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 7);
        
        return {
            id: 1,
            start_date: startDate,
            end_date: endDate,
            replaced: false,
            ...overrides,
        };
    };

    // ============================================
    // Status = 'unavailable' Tests
    // ============================================
    describe("given openToNextWork is false", () => {
        it("should return status = 'unavailable' regardless of schedules", async () => {
            // Arrange
            const row = createEmployeeRowWithSchedules({
                open_to_next_work: false,
                employee_schedule_employee_schedule_primary_employee_idToemployee: [
                    createActiveSchedule(),
                ],
            });
            employeeModel.findMany.mockResolvedValue([row]);

            // Act
            const result = await repository.findAll();

            // Assert
            expect(result[0].status).toBe('unavailable');
        });
    });

    // ============================================
    // Status = 'working' Tests
    // ============================================
    describe("given openToNextWork is true with active schedules", () => {
        it("should return status = 'working' when has active primary schedule", async () => {
            // Arrange
            const row = createEmployeeRowWithSchedules({
                open_to_next_work: true,
                employee_schedule_employee_schedule_primary_employee_idToemployee: [
                    createActiveSchedule(),
                ],
            });
            employeeModel.findMany.mockResolvedValue([row]);

            // Act
            const result = await repository.findAll();

            // Assert
            expect(result[0].status).toBe('working');
        });

        it("should return status = 'working' when has active secondary schedule", async () => {
            // Arrange
            const row = createEmployeeRowWithSchedules({
                open_to_next_work: true,
                employee_schedule_employee_schedule_secondary_employee_idToemployee: [
                    createActiveSchedule(),
                ],
            });
            employeeModel.findMany.mockResolvedValue([row]);

            // Act
            const result = await repository.findAll();

            // Assert
            expect(result[0].status).toBe('working');
        });
    });

    // ============================================
    // Status = 'available' Tests
    // ============================================
    describe("given openToNextWork is true with no active schedules", () => {
        it("should return status = 'available' when no schedules exist", async () => {
            // Arrange
            const row = createEmployeeRowWithSchedules({
                open_to_next_work: true,
            });
            employeeModel.findMany.mockResolvedValue([row]);

            // Act
            const result = await repository.findAll();

            // Assert
            expect(result[0].status).toBe('available');
        });

        it("should return status = 'available' when schedule is replaced", async () => {
            // Arrange
            const row = createEmployeeRowWithSchedules({
                open_to_next_work: true,
                employee_schedule_employee_schedule_primary_employee_idToemployee: [
                    createActiveSchedule({ replaced: true }),
                ],
            });
            employeeModel.findMany.mockResolvedValue([row]);

            // Act
            const result = await repository.findAll();

            // Assert
            expect(result[0].status).toBe('available');
        });
    });

    // ============================================
    // Edge Cases
    // ============================================
    describe("edge cases", () => {
        it("should handle schedule in the past", async () => {
            // Arrange
            const pastSchedule = createActiveSchedule();
            pastSchedule.start_date.setDate(pastSchedule.start_date.getDate() - 30);
            pastSchedule.end_date.setDate(pastSchedule.end_date.getDate() - 20);
            
            const row = createEmployeeRowWithSchedules({
                open_to_next_work: true,
                employee_schedule_employee_schedule_primary_employee_idToemployee: [pastSchedule],
            });
            employeeModel.findMany.mockResolvedValue([row]);

            // Act
            const result = await repository.findAll();

            // Assert
            expect(result[0].status).toBe('available');
        });

        it("should handle schedule in the future", async () => {
            // Arrange
            const futureSchedule = createActiveSchedule();
            futureSchedule.start_date.setDate(futureSchedule.start_date.getDate() + 20);
            futureSchedule.end_date.setDate(futureSchedule.end_date.getDate() + 30);
            
            const row = createEmployeeRowWithSchedules({
                open_to_next_work: true,
                employee_schedule_employee_schedule_primary_employee_idToemployee: [futureSchedule],
            });
            employeeModel.findMany.mockResolvedValue([row]);

            // Act
            const result = await repository.findAll();

            // Assert
            expect(result[0].status).toBe('available');
        });
    });
});
```

### Frontend Helper Test Template

```typescript
// frontend/src/features/employees/components/__tests__/EmployeesTable.helpers.test.ts

import { EmployeeStatus } from "../../types";

// Helper function to test (will be implemented in component)
type ChipColor = 'default' | 'warning' | 'success';

interface StatusChipConfig {
    color: ChipColor;
    labelKey: string;
}

const getStatusChipConfig = (status: EmployeeStatus | undefined): StatusChipConfig => {
    switch (status) {
        case 'available':
            return { color: 'success', labelKey: 'employees.status.available' };
        case 'working':
            return { color: 'warning', labelKey: 'employees.status.working' };
        case 'unavailable':
        default:
            return { color: 'default', labelKey: 'employees.status.unavailable' };
    }
};

const formatPhoneNumber = (phone: string | null | undefined): string => {
    if (!phone) return "-";
    const numbers = phone.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers || "-";
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
};

// ============================================
// getStatusChipConfig tests
// ============================================
describe("getStatusChipConfig", () => {
    describe("given 'unavailable' status", () => {
        it("should return gray/default chip config", () => {
            const result = getStatusChipConfig('unavailable');
            expect(result.color).toBe('default');
            expect(result.labelKey).toBe('employees.status.unavailable');
        });
    });

    describe("given 'working' status", () => {
        it("should return orange/warning chip config", () => {
            const result = getStatusChipConfig('working');
            expect(result.color).toBe('warning');
            expect(result.labelKey).toBe('employees.status.working');
        });
    });

    describe("given 'available' status", () => {
        it("should return green/success chip config", () => {
            const result = getStatusChipConfig('available');
            expect(result.color).toBe('success');
            expect(result.labelKey).toBe('employees.status.available');
        });
    });

    describe("given undefined status", () => {
        it("should fallback to unavailable config", () => {
            const result = getStatusChipConfig(undefined);
            expect(result.color).toBe('default');
            expect(result.labelKey).toBe('employees.status.unavailable');
        });
    });
});

// ============================================
// formatPhoneNumber tests
// ============================================
describe("formatPhoneNumber", () => {
    describe("given valid phone numbers", () => {
        it("should format 11-digit number correctly", () => {
            expect(formatPhoneNumber("01012345678")).toBe("010-1234-5678");
        });

        it("should handle already formatted numbers", () => {
            expect(formatPhoneNumber("010-1234-5678")).toBe("010-1234-5678");
        });
    });

    describe("given null/undefined/empty inputs", () => {
        it("should return '-' for null", () => {
            expect(formatPhoneNumber(null)).toBe("-");
        });

        it("should return '-' for undefined", () => {
            expect(formatPhoneNumber(undefined)).toBe("-");
        });

        it("should return '-' for empty string", () => {
            expect(formatPhoneNumber("")).toBe("-");
        });
    });
});
```

---

## Notes for Implementers

### Peter (Backend Test Writer)
1. Start with repository tests - they are the foundation
2. Use existing mock patterns from `sb.employee.repository.spec.ts`
3. Pay attention to date handling - use `setHours(0,0,0,0)` for consistent date comparison
4. The Prisma include relations have long names - copy them exactly from schema

### John (Frontend Test Writer)
1. Create new test file in `__tests__` folder following existing patterns
2. Helper functions can be tested in isolation before component integration
3. Use existing `formatPhoneNumber` from ClientFormDialog as reference

### Sisyphus-Junior (Implementer)
1. Follow TDD - make tests pass one by one
2. Repository implementation is the most complex - handle all edge cases
3. Frontend changes are mostly UI updates - follow existing patterns
4. Don't forget translations in both ko.json and en.json
