import type { SystemTemplateKey } from "./system-template";

// Shared alimtalk contracts used by both frontend and mobile.
//
// The source of truth for these shapes is the backend contract surface:
// - backend/interface/dto/alimtalk-trigger.dto.ts
// - backend/interface/dto/alimtalk-template.dto.ts
// - backend/interface/dto/system-setting.dto.ts
// - backend/domain/constants/alimtalk-trigger-catalog.ts
// - backend/domain/entities/alimtalk-trigger-rule.entity.ts
// - backend/domain/entities/system-setting.entity.ts
// - backend/application/services/alimtalk-trigger.service.ts
// - backend/application/services/alimtalk-template.service.ts
// - backend/domain/ports/aligo-api.port.ts
//
// Controllers return Date-backed entities/views directly for trigger rules,
// upcoming jobs, and history logs. Those dates serialize to ISO strings on
// the wire, so the shared client-facing response types below use string.

export type AlimtalkTriggerEventType =
  | "CLIENT_CREATED"
  | "SERVICE_START"
  | "SERVICE_END"
  | "EMPLOYEE_ASSIGNED";

export type AlimtalkTriggerOffsetType =
  | "IMMEDIATE"
  | "SAME_DAY"
  | "BEFORE_DAYS"
  | "AFTER_DAYS";

export type AlimtalkTriggerRecipientType =
  | "CLIENT"
  | "PRIMARY_EMPLOYEE"
  | "SECONDARY_EMPLOYEE";

export type AlimtalkTriggerTemplateKey =
  | "CLIENT_WELCOME"
  | "SERVICE_START_REMINDER"
  | "SERVICE_INFO"
  | "SERVICE_END_REMINDER"
  | "EMPLOYEE_ASSIGNED"
  | "CLIENT_GREETING"
  | "PRICE_INFO"
  | "REMINDER"
  | "THANKS"
  | "SURVEY"
  | "INFO";

// Which system template's body each SMS trigger template renders. One source of truth for
// both the backend SMS delivery (SMS_TEMPLATE_DELIVERY.systemTemplateKey) and the form preview.
export const SMS_TRIGGER_TO_SYSTEM_TEMPLATE: Partial<Record<AlimtalkTriggerTemplateKey, SystemTemplateKey>> = {
  SERVICE_INFO: "SERVICE_INFO",
  CLIENT_GREETING: "GREETING",
  PRICE_INFO: "PRICE_INFO",
  REMINDER: "REMINDER",
  THANKS: "THANKS",
  SURVEY: "SURVEY",
  INFO: "INFO",
};

// Canonical source of truth for which trigger templates are delivered over SMS (vs alimtalk).
// Adding a new SMS template here flows it through the SMS form's data-driven dropdowns, the
// channel filters, and the backend delivery drift guard — no hardcoded per-surface lists.
export const SMS_TRIGGER_TEMPLATE_KEYS: AlimtalkTriggerTemplateKey[] = [
  "SERVICE_INFO",
  "CLIENT_GREETING",
  "PRICE_INFO",
  "REMINDER",
  "THANKS",
  "SURVEY",
  "INFO",
];

export function getTriggerTemplateChannel(
  key: AlimtalkTriggerTemplateKey,
): "sms" | "alimtalk" {
  return SMS_TRIGGER_TEMPLATE_KEYS.includes(key) ? "sms" : "alimtalk";
}

export type SupportedTriggerProvider = "aligo" | "channeltalk";
export type AlimtalkProvider = SupportedTriggerProvider | "none";

export interface AlimtalkTriggerTemplateVariable {
  key: string;
  label: string;
}

export interface AlimtalkTriggerTemplateProviderConfig {
  templateKey: string;
}

export interface AlimtalkTriggerTemplateCatalogItem {
  key: AlimtalkTriggerTemplateKey;
  name: string;
  description: string;
  allowedEventTypes: AlimtalkTriggerEventType[];
  allowedRecipientTypes: AlimtalkTriggerRecipientType[];
  requiredVariables: AlimtalkTriggerTemplateVariable[];
  providers: Partial<
    Record<SupportedTriggerProvider, AlimtalkTriggerTemplateProviderConfig>
  >;
}

export interface AlimtalkTriggerRule {
  id: string;
  branchId: string | null;
  name: string;
  isActive: boolean;
  eventType: AlimtalkTriggerEventType;
  offsetType: AlimtalkTriggerOffsetType;
  offsetDays: number;
  recipientType: AlimtalkTriggerRecipientType;
  templateKey: AlimtalkTriggerTemplateKey;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlimtalkTriggerRuleDto {
  name: string;
  isActive?: boolean;
  eventType: AlimtalkTriggerEventType;
  offsetType: AlimtalkTriggerOffsetType;
  offsetDays?: number;
  recipientType: AlimtalkTriggerRecipientType;
  templateKey: AlimtalkTriggerTemplateKey;
}

export type UpdateAlimtalkTriggerRuleDto = Partial<CreateAlimtalkTriggerRuleDto>;

export type AlimtalkTriggerJobStatus =
  | "pending"
  | "sent"
  | "failed"
  | "canceled";

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
  eventType: AlimtalkTriggerEventType | null;
  offsetType: AlimtalkTriggerOffsetType | null;
  offsetDays: number;
  recipientType: AlimtalkTriggerRecipientType;
  recipientPhone: string | null;
  templateKey: AlimtalkTriggerTemplateKey;
  status: AlimtalkTriggerJobStatus;
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
  eventType: AlimtalkTriggerEventType | null;
  offsetType: AlimtalkTriggerOffsetType | null;
  offsetDays: number;
  scheduledFor: string | null;
  recipientType: AlimtalkTriggerRecipientType | null;
  recipientName: string | null;
  clientName: string | null;
  employeeName: string | null;
}

export interface AlimtalkProviderResponse {
  provider: AlimtalkProvider;
  enabled: boolean;
  updatedAt?: string;
}

export type AlimtalkTemplateType = "BA" | "EX" | "AD" | "MI";
export type AlimtalkTemplateEmphasisType = "NONE" | "TEXT" | "IMAGE";
export type AlimtalkTemplateButtonLinkType =
  | "WL"
  | "AL"
  | "BK"
  | "MD"
  | "DS"
  | "AC";

export interface AlimtalkTemplateButton {
  name: string;
  linkType: AlimtalkTemplateButtonLinkType;
  linkM?: string;
  linkP?: string;
  linkI?: string;
  linkA?: string;
}

export interface CreateAlimtalkTemplateButtonDto
  extends AlimtalkTemplateButton {}

export interface CreateAlimtalkTemplateDto {
  name: string;
  tplType: AlimtalkTemplateType;
  tplEmType: AlimtalkTemplateEmphasisType;
  title?: string;
  subtitle?: string;
  content: string;
  extra?: string;
  advert?: string;
  buttons: CreateAlimtalkTemplateButtonDto[];
}

export interface AlimtalkTemplateListItem {
  templateCode: string;
  name: string;
  content: string;
  title?: string;
  subtitle?: string;
  extra?: string;
  advert?: string;
  templateType: AlimtalkTemplateType;
  emphasisType: AlimtalkTemplateEmphasisType;
  inspectionStatus?: string;
  isApproved: boolean;
  category?: string;
  buttons: AlimtalkTemplateButton[];
  createdAt?: string;
  updatedAt?: string;
  senderKey?: string;
}

// The create-template endpoint currently returns the raw Aligo payload.
export interface AligoTemplateCreateResponse {
  code: number;
  message: string;
  info?: Record<string, unknown>;
}
