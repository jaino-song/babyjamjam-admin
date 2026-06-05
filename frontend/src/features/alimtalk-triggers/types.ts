import type { AlimtalkProvider } from "@/services/api";

export type TriggerEventType =
    | "CLIENT_CREATED"
    | "SERVICE_START"
    | "SERVICE_END"
    | "EMPLOYEE_ASSIGNED";

export type TriggerOffsetType = "IMMEDIATE" | "SAME_DAY" | "BEFORE_DAYS" | "AFTER_DAYS";

export type TriggerRecipientType = "CLIENT" | "PRIMARY_EMPLOYEE" | "SECONDARY_EMPLOYEE";

export type TriggerTemplateKey =
    | "CLIENT_WELCOME"
    | "SERVICE_START_REMINDER"
    | "SERVICE_INFO"
    | "SERVICE_END_REMINDER"
    | "EMPLOYEE_ASSIGNED";

export interface AlimtalkTriggerRule {
    id: string;
    branchId: string | null;
    name: string;
    isActive: boolean;
    eventType: TriggerEventType;
    offsetType: TriggerOffsetType;
    offsetDays: number;
    recipientType: TriggerRecipientType;
    templateKey: TriggerTemplateKey;
    createdAt: string;
    updatedAt: string;
}

export interface TriggerTemplateVariable {
    key: string;
    label: string;
}

export interface TriggerTemplateCatalogItem {
    key: TriggerTemplateKey;
    name: string;
    description: string;
    allowedEventTypes: TriggerEventType[];
    allowedRecipientTypes: TriggerRecipientType[];
    requiredVariables: TriggerTemplateVariable[];
    providers: Partial<Record<Exclude<AlimtalkProvider, "none">, { templateKey: string }>>;
}

export interface UpcomingAlimtalkJobPayload {
    clientId?: number | null;
    clientName?: string | null;
    employeeId?: number | null;
    employeeName?: string | null;
    memberId: string;
    recipientName: string;
    recipientPhone: string;
    templateVariables: Record<string, string>;
    buttonUrl?: string | null;
}

export interface UpcomingAlimtalkJob {
    id: string;
    ruleId: string;
    ruleName: string;
    eventType: TriggerEventType | null;
    offsetType: TriggerOffsetType | null;
    offsetDays: number;
    recipientType: TriggerRecipientType;
    recipientPhone: string | null;
    templateKey: TriggerTemplateKey;
    status: "pending" | "sent" | "failed" | "canceled";
    scheduledFor: string;
    sentAt: string | null;
    canceledAt: string | null;
    cancelReason: string | null;
    clientId: number | null;
    employeeScheduleId: number | null;
    payload: UpcomingAlimtalkJobPayload;
    createdAt: string;
    updatedAt: string;
}

export type AlimtalkHistoryStatus = "pending" | "sent" | "failed";

export interface AlimtalkHistoryRecord {
    id: number;
    provider: string;
    templateKey: string;
    triggerJobId: string | null;
    receiver: string;
    clientId: number | null;
    messageBody: string;
    variables: Record<string, string>;
    status: AlimtalkHistoryStatus;
    aligoMid: string | null;
    errorMessage: string | null;
    attempts: number;
    lastAttemptAt: string | null;
    nextRetryAt: string | null;
    createdAt: string;
    updatedAt: string;
    ruleId: string | null;
    ruleName: string | null;
    eventType: TriggerEventType | null;
    offsetType: TriggerOffsetType | null;
    offsetDays: number;
    scheduledFor: string | null;
    recipientType: TriggerRecipientType | null;
    recipientName: string | null;
    clientName: string | null;
    employeeName: string | null;
}

export interface CreateAlimtalkTriggerRuleDto {
    name: string;
    isActive?: boolean;
    eventType: TriggerEventType;
    offsetType: TriggerOffsetType;
    offsetDays?: number;
    recipientType: TriggerRecipientType;
    templateKey: TriggerTemplateKey;
}

export type UpdateAlimtalkTriggerRuleDto = Partial<CreateAlimtalkTriggerRuleDto>;
