// Shared message contracts used by both frontend and mobile.
//
// The source of truth for these shapes is the backend contract surface:
// - backend/interface/dto/message.dto.ts
// - backend/interface/dto/message-template.dto.ts
// - backend/interface/dto/message-delivery.dto.ts
// - backend/interface/dto/message-sender-approval.dto.ts
// - backend/interface/dto/system-admin.dto.ts
// - backend/domain/entities/message.entity.ts
// - backend/domain/entities/message-template.entity.ts
// - backend/interface/controllers/message-delivery.controller.ts
// - backend/interface/controllers/system-setting.controller.ts
// - backend/application/services/system-admin.service.ts
//
// Message and message-template controllers currently return Date-backed
// entities directly. Those dates serialize to ISO strings on the wire, so the
// client-facing response types below use string while Raw* variants retain Date
// for backend-reference parity.

export type MessageTemplateVariableType =
  | "text"
  | "phone"
  | "select"
  | "date"
  | "number"
  | "textarea";

export type MessageTemplateVariableOptionType = "custom" | "dataSource";

export interface MessageTemplateVariable {
  key: string;
  type: MessageTemplateVariableType;
  label: string;
  placeholder?: string;
  required: boolean;
  optionType?: MessageTemplateVariableOptionType;
  options?: string[];
  dataSource?: string;
  min?: number;
  max?: number;
}

export interface RawMessageRecord {
  id: number;
  title: string;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
}

export interface MessageRecord {
  id: number;
  title: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
}

export interface CreateMessageRequest {
  title: string;
  text: string;
}

export interface UpdateMessageRequest {
  title: string;
  text: string;
}

export interface RawMessageTemplate {
  id: string;
  name: string;
  content: string;
  variables: MessageTemplateVariable[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  variables: MessageTemplateVariable[];
  createdAt: string;
  updatedAt: string;
}

export type MessageTemplateListResponse = MessageTemplate[];

export interface CreateMessageTemplateRequest {
  name: string;
  content: string;
  variables: MessageTemplateVariable[];
}

export interface UpdateMessageTemplateRequest {
  name?: string;
  content?: string;
  variables?: MessageTemplateVariable[];
}

export type MessageDeliverySmsType = "AUTO" | "SMS" | "LMS";
export type MessageDeliveryTriggerType = "immediate" | "scheduled";
export type MessageDeliveryResolvedSmsType = "SMS" | "LMS";
export type MessageDeliveryProviderSmsType = "SMS" | "LMS" | "MMS";

export interface SendMessageDeliverySmsRequest {
  receiver: string;
  message: string;
  title?: string;
  recipientName?: string;
  clientId?: number;
  msgType?: MessageDeliverySmsType;
  triggerType?: MessageDeliveryTriggerType;
  scheduledDate?: string;
  scheduledTime?: string;
  testMode?: boolean;
}

export interface SendMessageDeliverySmsResponse {
  provider: "aligo";
  triggerType: MessageDeliveryTriggerType;
  request: {
    senderPhone?: string;
    receiver: string;
    msgType: MessageDeliveryResolvedSmsType;
    scheduledAt?: string;
    testMode: boolean;
  };
  result: {
    resultCode: number;
    message: string;
    msgId?: number;
    successCount?: number;
    errorCount?: number;
    msgType?: MessageDeliveryProviderSmsType;
  };
}

export const MESSAGE_SENDER_APPROVAL_STATUSES = [
  "not_requested",
  "pending",
  "approved",
] as const;

export type MessageSenderApprovalStatus =
  (typeof MESSAGE_SENDER_APPROVAL_STATUSES)[number];

export interface MessageSenderApprovalResponse {
  approvalStatus: MessageSenderApprovalStatus;
  isApproved: boolean;
  canRequest: boolean;
  requestedAt: string | null;
  approvedAt: string | null;
}

export interface SystemAdminBranchUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export interface SystemAdminBranchMessageSenderApproval {
  approvalStatus: MessageSenderApprovalStatus;
  requestedAt: string | null;
  approvedAt: string | null;
  requestedBy: SystemAdminBranchUser | null;
}

export interface SystemAdminBranchRequest {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  district: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  owner: SystemAdminBranchUser;
  messageSenderApproval: SystemAdminBranchMessageSenderApproval;
}
