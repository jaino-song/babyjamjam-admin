// Query key factory for employees
export const employeeKeys = {
    all: ['employees'] as const,
    lists: () => [...employeeKeys.all, 'list'] as const,
    list: (filters: Record<string, unknown>) => [...employeeKeys.lists(), filters] as const,
    details: () => [...employeeKeys.all, 'detail'] as const,
    detail: (id: number) => [...employeeKeys.details(), id] as const,
};
