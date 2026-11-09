// Employee summary for client responses
export interface EmployeeSummary {
    id: number;
    name: string;
    phone?: string | null;
}

// Document status type for eformsign documents
export type DocumentStatus = 'created' | 'opened' | 'completed' | 'requested' | 'revoke_requested' | 'rejected' | 'revoked' | 'deleted' | 'voided' | null;

export type ClientBadgeKey = "contract_required" | "contract_status" | "breast_pump" | "service_status" | "care_center";
export type ClientBadgeTone = "danger" | "success" | "primary" | "warning" | "neutral";
export type ClientBadgeStatus =
    | "active"
    | "preBooking"
    | "pending"
    | "review"
    | "terminated"
    | "expired"
    | "completed"
    | "signed"
    | "breastPump"
    | "careCenter";

export interface ClientBadge {
    key: ClientBadgeKey;
    status: ClientBadgeStatus;
    label: string;
    tone: ClientBadgeTone;
    priority: number;
}

// Client entity types
import type { ClientActionRequired } from "@babyjamjam/shared/types/client-action-required";
import type { StartDateChangeMode } from "@babyjamjam/shared";

export type {
    ActionRequiredReason,
    ClientActionRequired,
} from "@babyjamjam/shared/types/client-action-required";

export interface Client {
    id: number;
    name: string;
    createdAt?: string | null;
    birthday: string | null;           // YYMMDD format
    dueDate: string | null;
    birthDate: string | null;
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
    careCenter: boolean | null;
    voucherClient: boolean;
    breastPump: boolean;
    serviceStatus: ServiceStatus | null;      // Renamed from contractStatus
    bookingConfirmedAt: string | null;
    eDocId: string | null;
    areaId?: string | null;
    /** false이면 이 고객에게 자동 문자가 발송되지 않아요. 직접 발송은 가능해요. */
    smsAutomationEnabled?: boolean;
    /** 토·일·공휴일에도 서비스하는 고객인지 (미지정이면 false). */
    allowSaturdayService?: boolean;
    allowSundayService?: boolean;
    allowHolidayService?: boolean;
    hasSigned: boolean;
    documentStatus: DocumentStatus;    // eformsign document status: created/opened/completed
    /** ID of the same latest contract used for documentStatus. */
    latestContractDocumentId?: string | null;
    badges?: ClientBadge[];
    actionRequired?: ClientActionRequired | null;
    /** 서비스 기록이 확정 단계라 시작일·종료일·서비스 기간을 바꿀 수 없어요. */
    serviceRecordPeriodLocked?: boolean;
}

// Create client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface CreateClientDto {
    name: string;
    birthday?: string | null;
    dueDate?: string | null;
    birthDate?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    /** Set only after the service-period confirmation for this save. */
    allowBusinessDayMismatch?: boolean;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    breastPump: boolean;
    serviceStatus?: ServiceStatus | null;
    applyMessageAutomation?: boolean;
    /** 명시하면 applyMessageAutomation보다 우선해요. */
    smsAutomationEnabled?: boolean;
    /** 토·일·공휴일에도 서비스하는 고객인지 (미지정이면 false). */
    allowSaturdayService?: boolean;
    allowSundayService?: boolean;
    allowHolidayService?: boolean;
    areaId?: string | null;
    source?: "contract_auto_registration";
    reuseExistingClient?: boolean;
}

export type ClientFormData = Omit<CreateClientDto, "primaryEmployeeId" | "allowBusinessDayMismatch"> & { primaryEmployeeId: number | null };

// Update client DTO - Frontend sends employeeId, backend converts to scheduleId
export interface UpdateClientDto {
    /** Set only after an explicit start-date change confirmation for this save. */
    startDateChangeMode?: StartDateChangeMode;
    name?: string;
    birthday?: string | null;
    dueDate?: string | null;
    birthDate?: string | null;
    address?: string | null;
    phone?: string | null;
    primaryEmployeeId?: number | null;  // Employee ID (backend converts to schedule)
    secondaryEmployeeId?: number | null; // Employee ID (backend converts to schedule)
    type?: string | null;
    duration?: number | null;
    /** Set only after the service-period confirmation for this save. */
    allowBusinessDayMismatch?: boolean;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    careCenter?: boolean | null;
    areaId?: string | null;
    smsAutomationEnabled?: boolean;
    /** 토·일·공휴일에도 서비스하는 고객인지 (미지정이면 false). */
    allowSaturdayService?: boolean;
    allowSundayService?: boolean;
    allowHolidayService?: boolean;
    voucherClient?: boolean;
    breastPump?: boolean;
    serviceStatus?: ServiceStatus | null;
    /**
     * The end date (YYYY-MM-DD, or null for none) the edit form was opened with. Sent with any
     * service-period change so the backend answers 409 instead of overwriting an end date that
     * moved meanwhile. Not a field to update.
     */
    expectedEndDate?: string | null;
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

export const CLIENT_LIST_TAB_VALUES = [
    "all",
    "pre_booking",
    "waiting",
    "replacement_requested",
    "active",
    "completed",
    "terminated",
] as const;

export type ClientListTab = typeof CLIENT_LIST_TAB_VALUES[number];

export interface ClientListSummary {
    total: number;
    byTab: Record<ClientListTab, number>;
    dueDate: {
        thisMonth: number;
        nextMonth: number;
    };
    serviceEnd: {
        count: number;
        from: string;
        to: string;
    };
}

// Service status options (renamed from Contract status)
export const SERVICE_STATUS_OPTIONS = [
    { value: "pre_booking", label: "예약 전", labelEn: "Pre-booking", color: "default" as const },
    { value: "waiting", label: "대기", labelEn: "Waiting", color: "warning" as const },
    { value: "replacement_requested", label: "교체 요청", labelEn: "Replacement Requested", color: "error" as const },
    { value: "active", label: "진행중", labelEn: "Active", color: "info" as const },
    { value: "completed", label: "완료", labelEn: "Completed", color: "success" as const },
    { value: "terminated", label: "중단", labelEn: "Terminated", color: "default" as const },
] as const;

export type ServiceStatus = typeof SERVICE_STATUS_OPTIONS[number]["value"];

/**
 * Whether "제공기록지 일정 변경" can be offered for this client. The backend only creates a service-record case
 * once the booking is confirmed, so for an effectively 예약 전 client the schedule load answers 404 and a retry can
 * never succeed. `serviceStatus` in the client response already holds the effective status; null/undefined counts
 * as 예약 전, matching the backend gate (service-record-lifecycle.service.ts) and the confirm-booking check.
 */
export function canEditServiceRecordSchedule(client: { serviceStatus?: ServiceStatus | null }): boolean {
    return (client.serviceStatus ?? "pre_booking") !== "pre_booking";
}

// Legacy export for backwards compatibility (deprecated)
/** @deprecated Use SERVICE_STATUS_OPTIONS instead */
export const CONTRACT_STATUS_OPTIONS = SERVICE_STATUS_OPTIONS;
/** @deprecated Use ServiceStatus instead */
export type ContractStatus = ServiceStatus;
