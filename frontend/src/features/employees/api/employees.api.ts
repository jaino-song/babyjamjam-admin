import { api } from '@/core/api/client';
import type { Employee, CreateEmployeeDto, UpdateEmployeeDto } from '../types';

export const employeesApi = {
    list: () => api.get<Employee[]>('/employees'),

    getById: (id: number) => api.get<Employee>(`/employees/${id}`),

    create: (data: CreateEmployeeDto) => api.post<Employee>('/employees', data),

    update: (id: number, data: UpdateEmployeeDto) =>
        api.patch<Employee>('/employees', data, { params: { id } }),

    delete: (id: number) => api.delete(`/employees`, { params: { id } }),

    toggleOpenStatus: (id: number, openToNextWork: boolean) =>
        api.patch<Employee>('/employees/open-status', { openToNextWork }, { params: { id } }),
};
