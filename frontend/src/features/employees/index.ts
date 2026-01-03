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

// Components
export { EmployeesTable } from './components/EmployeesTable';
export { EmployeeFormDialog } from './components/EmployeeFormDialog';
export { EmployeeDetailModal } from './components/EmployeeDetailModal';

// API (for advanced usage)
export { employeesApi } from './api/employees.api';
