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
