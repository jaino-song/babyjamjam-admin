"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/app/lib/axios/client";

// Employee type
export interface Employee {
    id: number;
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: string;
}

export interface CreateEmployeeDto {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
}

export interface UpdateEmployeeDto {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
}

// Query key factory pattern
export const employeeQueryKeys = {
    all: ["employees"] as const,
    lists: () => [...employeeQueryKeys.all, "list"] as const,
    list: (filters: Record<string, unknown>) => [...employeeQueryKeys.lists(), filters] as const,
    details: () => [...employeeQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...employeeQueryKeys.details(), id] as const,
};

// Fetch all employees
export function useEmployees() {
    return useQuery<Employee[]>({
        queryKey: employeeQueryKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get("/employees");
            return data;
        },
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
}

// Create employee
export function useCreateEmployee() {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: async (dto: CreateEmployeeDto) => {
            const { data } = await api.post("/employees", dto);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}

// Update employee
export function useUpdateEmployee() {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: async ({ id, dto }: { id: number; dto: UpdateEmployeeDto }) => {
            const { data } = await api.patch("/employees", dto, { params: { id } });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}

// Delete employee
export function useDeleteEmployee() {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete("/employees", { params: { id } });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}

// Toggle open status
export function useToggleEmployeeOpenStatus() {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: async ({ id, openToNextWork }: { id: number; openToNextWork: boolean }) => {
            const { data } = await api.patch("/employees/open-status", { openToNextWork }, { params: { id } });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}
