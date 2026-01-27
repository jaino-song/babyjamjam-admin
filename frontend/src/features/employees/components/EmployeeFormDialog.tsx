"use client";

/**
 * EmployeeFormDialog re-export for backward compatibility.
 *
 * This re-exports the canonical EmployeeFormDialog from app/(components)
 * which includes:
 * - Zustand store integration for prefilling employee name
 * - Error handling with visual feedback
 * - onSuccess callback for auto-selecting newly created employees
 * - Query refetching for autocomplete sync
 *
 * For direct usage, you can also import from:
 * "@/app/(components)/employees/EmployeeFormDialog"
 */

export { EmployeeFormDialog } from "@/app/(components)/employees/EmployeeFormDialog";
