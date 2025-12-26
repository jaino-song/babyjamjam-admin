// Employee summary for client responses
export interface EmployeeSummary {
    id: number;
    name: string;
}

// Client entity types
export interface Client {
    id: number;
    name: string;
    birthday: string | null;           // YYMMDD format
    address: string | null;
    phone: string | null;
    primaryEmployee: EmployeeSummary | null;  // Primary employee info from active schedule
    secondaryEmployee: EmployeeSummary | null; // Secondary employee info from active schedule
    type: string | null;               // voucher type
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: string | null;
    endDate: string | null;
    careCenter: boolean;
    voucherClient: boolean;
    breastPump: boolean;
    contractStatus: string | null;
}

// Create client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface CreateClientDto {
    name: string;
    birthday?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter: boolean;
    voucherClient: boolean;
    breastPump: boolean;
    contractStatus?: string | null;
}

// Update client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface UpdateClientDto {
    name?: string;
    birthday?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId?: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter?: boolean;
    voucherClient?: boolean;
    breastPump?: boolean;
    contractStatus?: string | null;
}

// Paginated response
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Contract status options
export const CONTRACT_STATUS_OPTIONS = [
    { value: "pending", label: "대기", labelEn: "Pending" },
    { value: "in_progress", label: "진행 중", labelEn: "In Progress" },
    { value: "completed", label: "완료", labelEn: "Completed" },
    { value: "cancelled", label: "취소", labelEn: "Cancelled" },
] as const;

export type ContractStatus = typeof CONTRACT_STATUS_OPTIONS[number]["value"];
