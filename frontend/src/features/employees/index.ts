// Public API for employees feature module

// Types
export type {
    Employee,
    CreateEmployeeDto,
    UpdateEmployeeDto,
    Grade,
} from './types';
export { GRADE_OPTIONS } from './types';

// Hooks
export {
    useEmployees,
    useEmployee,
    useCreateEmployee,
    useUpdateEmployee,
    useDeleteEmployee,
    useToggleEmployeeOpenStatus,
} from './hooks/use-employees';
export { employeeKeys } from './hooks/keys';

// API (for advanced usage)
export { employeesApi } from './api/employees.api';

// Note: Components are now in app/(components)/employees/
// Import them directly from there instead

