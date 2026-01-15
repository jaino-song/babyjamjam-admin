// Employee summary for client responses
export interface EmployeeSummary {
    id: number;
    name: string;
}

// Document status type for eformsign documents
export type DocumentStatus = 'created' | 'opened' | 'completed' | 'requested' | 'rejected' | 'revoked' | 'deleted' | null;

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
    serviceStatus: string | null;      // Renamed from contractStatus
    eDocId: string | null;
    hasSigned: boolean;
    documentStatus: DocumentStatus;    // eformsign document status: created/opened/completed
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
    serviceStatus?: string | null;
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
    serviceStatus?: string | null;
}

// DTO for terminating service
export interface TerminateServiceDto {
    reason?: string;
}

// DTO for requesting replacement
export interface RequestReplacementDto {
    newPrimaryEmployeeId: number;
    newSecondaryEmployeeId?: number | null;
}

// Paginated response
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// Service status options (renamed from Contract status)
export const SERVICE_STATUS_OPTIONS = [
    { value: "waiting", label: "대기", labelEn: "Waiting", color: "warning" as const },
    { value: "active", label: "진행중", labelEn: "Active", color: "info" as const },
    { value: "completed", label: "완료", labelEn: "Completed", color: "success" as const },
    { value: "terminated", label: "중단", labelEn: "Terminated", color: "default" as const },
    { value: "replacement_requested", label: "교체 요청", labelEn: "Replacement Requested", color: "error" as const },
] as const;

export type ServiceStatus = typeof SERVICE_STATUS_OPTIONS[number]["value"];

// Legacy export for backwards compatibility (deprecated)
/** @deprecated Use SERVICE_STATUS_OPTIONS instead */
export const CONTRACT_STATUS_OPTIONS = SERVICE_STATUS_OPTIONS;
/** @deprecated Use ServiceStatus instead */
export type ContractStatus = ServiceStatus;
