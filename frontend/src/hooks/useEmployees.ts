"use client";

import {
    useInfiniteQuery,
    useQuery,
    useMutation,
    useQueryClient,
    type QueryKey,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import {
    removeById,
    restoreQueries,
    snapshotAndTransformQueries,
    type QuerySnapshot,
} from "@/lib/query/optimistic-list-cache";
import { deriveEmployeeStatus } from "@babyjamjam/shared/constants/employee-status";

// Employee status type
export type EmployeeStatus = 'available' | 'working' | 'unavailable';

// Employee type
export interface Employee {
    id: number;
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    registeredDate: string | null;
    status: EmployeeStatus;
    birthday?: string;
}

export interface CreateEmployeeDto {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    birthday?: string;
}

export interface UpdateEmployeeDto {
    name?: string;
    workArea?: string[];
    phone?: string;
    grade?: string;
    openToNextWork?: boolean;
    birthday?: string;
}

/** A currently active client assignment for an employee. */
export interface EmployeeActiveClient {
    clientId: number;
    clientName: string;
    role: "primary" | "secondary";
    startDate: string;
    endDate: string;
    serviceStatus: string;
}

/** A historical client assignment for an employee. */
export interface EmployeeWorkHistoryEntry {
    scheduleId: number;
    clientId: number;
    clientName: string;
    role: "primary" | "secondary";
    startDate: string;
    endDate: string;
    status: "completed" | "replaced";
}

export interface PaginatedEmployeeWorkHistory {
    data: EmployeeWorkHistoryEntry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Query key factory pattern
export const employeeQueryKeys = {
    all: ["employees"] as const,
    lists: () => [...employeeQueryKeys.all, "list"] as const,
    list: (filters: Record<string, unknown>) => [...employeeQueryKeys.lists(), filters] as const,
    details: () => [...employeeQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...employeeQueryKeys.details(), id] as const,
    activeClients: (id: number) => [...employeeQueryKeys.detail(id), "active-clients"] as const,
    workHistory: (id: number) => [...employeeQueryKeys.detail(id), "work-history"] as const,
};

// Fetch all employees
export function useEmployees({ refetchOnMount = true }: { refetchOnMount?: boolean | "always" } = {}) {
    return useQuery<Employee[]>({
        queryKey: employeeQueryKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get("/employees");
            return data;
        },
        staleTime: 1000 * 60 * 10, // 10 minutes
        refetchOnMount,
    });
}

/** Fetch the clients currently assigned to an employee. */
export function useEmployeeActiveClients(employeeId: number) {
    return useQuery<EmployeeActiveClient[]>({
        queryKey: employeeQueryKeys.activeClients(employeeId),
        queryFn: async () => {
            const { data } = await api.get<EmployeeActiveClient[]>(
                `/employees/${employeeId}/active-clients`,
            );
            return data;
        },
        enabled: Number.isSafeInteger(employeeId) && employeeId > 0,
        staleTime: 1000 * 60 * 5,
    });
}

/** Fetch an employee's historical assignments with the same pagination semantics as mobile. */
export function useEmployeeWorkHistory(employeeId: number, limit = 20) {
    const query = useInfiniteQuery<PaginatedEmployeeWorkHistory>({
        queryKey: [...employeeQueryKeys.workHistory(employeeId), limit],
        queryFn: async ({ pageParam }) => {
            const { data } = await api.get<PaginatedEmployeeWorkHistory>(
                `/employees/${employeeId}/work-history?page=${pageParam}&limit=${limit}`,
            );
            return data;
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (
            lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined
        ),
        enabled: Number.isSafeInteger(employeeId) && employeeId > 0,
        staleTime: 1000 * 60 * 5,
    });

    const history = query.data?.pages.flatMap((pageData) => pageData.data ?? []) ?? [];
    const total = query.data?.pages.at(-1)?.total ?? history.length;

    return {
        ...query,
        history,
        total,
    };
}

// Create employee
export function useCreateEmployee() {
    const queryClient = useQueryClient();

    return useMutation<Employee, Error, CreateEmployeeDto, EmployeeCacheMutationContext>({
        mutationFn: async (dto: CreateEmployeeDto) => {
            const { data } = await api.post<Employee>("/employees", dto);
            return data;
        },
        onMutate: async () => {
            const queries = captureEmployeeQueryReferences(queryClient);
            await queryClient.cancelQueries({ queryKey: employeeQueryKeys.lists() });
            return { queries };
        },
        onSuccess: async (employee, _dto, context) => {
            if (patchEmployeeListQueries(queryClient, employee, context)) {
                await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
            }
        },
        onError: async (error, _dto, context) => {
            console.error("[useCreateEmployee] onError called:", error);
            await refetchOwnedEmployeeListQueries(queryClient, context);
        },
    });
}

// Update employee
export function useUpdateEmployee() {
    const queryClient = useQueryClient();

    return useMutation<Employee, Error, { id: number; dto: UpdateEmployeeDto }, EmployeeCacheMutationContext>({
        mutationFn: async ({ id, dto }: { id: number; dto: UpdateEmployeeDto }) => {
            const { data } = await api.patch<Employee>("/employees", dto, { params: { id } });
            return data;
        },
        onMutate: async () => {
            const queries = captureEmployeeQueryReferences(queryClient);
            await queryClient.cancelQueries({ queryKey: employeeQueryKeys.lists() });
            return { queries };
        },
        onSuccess: async (employee, _variables, context) => {
            if (patchEmployeeListQueries(queryClient, employee, context)) {
                await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
            }
        },
        onError: async (_error, _variables, context) => {
            await refetchOwnedEmployeeListQueries(queryClient, context);
        },
    });
}

// Removes an employee from a cached list. Non-list shapes pass through unchanged.
function removeEmployeeFromCacheData(current: unknown, id: number): unknown {
    if (!Array.isArray(current)) return current;
    return removeById(current as Employee[], id);
}

function isEmployeeStatus(value: unknown): value is Employee["status"] {
    return value === "available" || value === "working" || value === "unavailable";
}

function mergeEmployeeIntoListCacheData(current: unknown, employee: Employee): unknown {
    if (!Array.isArray(current)) return current;

    const existing = current.find((item) => isRecord(item) && item.id === employee.id);
    const status = existing?.status === "working"
        ? "working"
        : isEmployeeStatus(employee.status)
            ? employee.status
            : deriveEmployeeStatus(false, employee.openToNextWork);
    const nextEmployee = { ...employee, status };

    if (!existing) return [...current, nextEmployee];

    return current.map((item) => (
        isRecord(item) && item.id === employee.id
            ? { ...item, ...nextEmployee }
            : item
    ));
}

function patchEmployeeListQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    employee: Employee,
    context: EmployeeCacheMutationContext | undefined,
): boolean {
    let hasOriginalListQuery = false;

    for (const { queryKey } of getOwnedEmployeeListQueries(queryClient, context)) {
        hasOriginalListQuery = true;
        queryClient.setQueryData(queryKey, (current: unknown) => (
            mergeEmployeeIntoListCacheData(current, employee)
        ));
    }

    return hasOriginalListQuery;
}

function getOwnedEmployeeListQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    context: EmployeeCacheMutationContext | undefined,
): EmployeeQueryReference[] {
    return (context?.queries ?? []).filter(({ queryKey, query }) => (
        isEmployeeListQueryKey(queryKey)
        && queryClient.getQueryCache().find({ queryKey, exact: true }) === query
    ));
}

async function refetchOwnedEmployeeListQueries(
    queryClient: ReturnType<typeof useQueryClient>,
    context: EmployeeCacheMutationContext | undefined,
): Promise<void> {
    await Promise.all(
        getOwnedEmployeeListQueries(queryClient, context).map(({ queryKey }) => (
            queryClient.refetchQueries({ queryKey, exact: true })
        )),
    );
}

// Delete employee
export function useDeleteEmployee() {
    const queryClient = useQueryClient();

    return useMutation<void, Error, number, { previous: QuerySnapshot }>({
        mutationFn: async (id: number) => {
            await api.delete("/employees", { params: { id } });
        },
        onMutate: async (id) => {
            // Scope to list keys so detail caches are never optimistically edited.
            const previous = await snapshotAndTransformQueries(
                queryClient,
                { queryKey: employeeQueryKeys.lists() },
                (current) => removeEmployeeFromCacheData(current, id),
            );
            return { previous };
        },
        onError: (_error, _id, context) => {
            if (context?.previous) restoreQueries(queryClient, context.previous);
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
        },
    });
}

interface EmployeeQueryReference {
    queryKey: QueryKey;
    query: unknown;
}

interface EmployeeCacheMutationContext {
    queries: EmployeeQueryReference[];
}

interface ToggleEmployeeOpenStatusContext {
    queries: EmployeeQueryReference[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isEmployeeDetailQueryKey(queryKey: QueryKey): boolean {
    return queryKey.length === 3
        && queryKey[0] === employeeQueryKeys.all[0]
        && queryKey[1] === "detail"
        && typeof queryKey[2] === "number";
}

function isEmployeeListQueryKey(queryKey: QueryKey): boolean {
    return queryKey.length >= 2
        && queryKey[0] === employeeQueryKeys.all[0]
        && queryKey[1] === "list";
}

function captureEmployeeQueryReferences(queryClient: ReturnType<typeof useQueryClient>): EmployeeQueryReference[] {
    const queryKeys = [
        ...queryClient.getQueriesData({ queryKey: employeeQueryKeys.lists() }).map(([queryKey]) => queryKey),
        ...queryClient
            .getQueriesData({ queryKey: employeeQueryKeys.details() })
            .map(([queryKey]) => queryKey)
            .filter(isEmployeeDetailQueryKey),
    ];

    return queryKeys.flatMap((queryKey) => {
        const query = queryClient.getQueryCache().find({ queryKey, exact: true });
        return query ? [{ queryKey, query }] : [];
    });
}

function updateEmployeeOpenStatusInCache(
    current: unknown,
    id: number,
    openToNextWork: boolean,
    confirmedStatus?: Employee["status"],
): unknown {
    if (Array.isArray(current)) {
        let changed = false;
        const next = current.map((item) => {
            if (!isRecord(item) || item.id !== id) {
                return item;
            }

            const nextStatus = item.status === "working"
                ? "working"
                : confirmedStatus ?? deriveEmployeeStatus(false, openToNextWork);
            if (item.openToNextWork === openToNextWork && item.status === nextStatus) {
                return item;
            }

            changed = true;
            return { ...item, openToNextWork, status: nextStatus };
        });

        return changed ? next : current;
    }

    if (!isRecord(current) || current.id !== id) {
        return current;
    }

    const nextStatus = current.status === "working"
        ? "working"
        : confirmedStatus ?? deriveEmployeeStatus(false, openToNextWork);
    if (current.openToNextWork === openToNextWork && current.status === nextStatus) {
        return current;
    }

    return { ...current, openToNextWork, status: nextStatus };
}

function getConfirmedEmployeeStatus(data: unknown): Employee["status"] | undefined {
    if (!isRecord(data) || !isEmployeeStatus(data.status)) return undefined;
    return data.status;
}

// Toggle open status
export function useToggleEmployeeOpenStatus() {
    const queryClient = useQueryClient();

    return useMutation<unknown, Error, { id: number; openToNextWork: boolean }, ToggleEmployeeOpenStatusContext>({
        mutationFn: async ({ id, openToNextWork }: { id: number; openToNextWork: boolean }) => {
            const { data } = await api.patch("/employees/open-status", { openToNextWork }, { params: { id } });
            return data;
        },
        onMutate: async (): Promise<ToggleEmployeeOpenStatusContext> => {
            const queries = captureEmployeeQueryReferences(queryClient);

            await Promise.all([
                queryClient.cancelQueries({ queryKey: employeeQueryKeys.lists() }),
                queryClient.cancelQueries({ queryKey: employeeQueryKeys.details() }),
            ]);

            return { queries };
        },
        onSuccess: async (_data, { id, openToNextWork }, context) => {
            const confirmedStatus = getConfirmedEmployeeStatus(_data);
            let hasOriginalListQuery = false;
            for (const { queryKey, query } of context?.queries ?? []) {
                const currentQuery = queryClient.getQueryCache().find({ queryKey, exact: true });
                if (currentQuery !== query) continue;

                if (isEmployeeListQueryKey(queryKey)) {
                    hasOriginalListQuery = true;
                }
                queryClient.setQueryData(queryKey, (current: unknown) => (
                    updateEmployeeOpenStatusInCache(current, id, openToNextWork, confirmedStatus)
                ));
            }

            // Keep the confirmed mutation value visible while a refresh is pending;
            // the next server response may still replace it with a newer external value.
            if (hasOriginalListQuery) {
                await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
            }
        },
    });
}
