import type {
  MessageTriggerEventType,
  MessageTriggerOffsetType,
  MessageTriggerRecipientType,
  MessageTriggerTemplateCatalogItem,
  MessageTriggerTemplateKey,
  MessageTriggerTemplateVariable,
} from "@babyjamjam/shared/types/message";

export * from "@babyjamjam/shared/types/message";

export type TriggerEventType = MessageTriggerEventType;
export type TriggerOffsetType = MessageTriggerOffsetType;
export type TriggerRecipientType = MessageTriggerRecipientType;
export type TriggerTemplateKey = MessageTriggerTemplateKey;
export type TriggerTemplateVariable = MessageTriggerTemplateVariable;
export type TriggerTemplateCatalogItem = MessageTriggerTemplateCatalogItem;

/**
 * Safe, client-scoped view of a scheduled automation job.
 *
 * The client detail surface intentionally receives no recipient phone,
 * message body, button URL, or template variables. The backend endpoint owns
 * the projection; keeping a separate frontend type prevents the broad admin
 * upcoming-job payload from leaking into this view.
 */
export type ClientUpcomingMessageTriggerJobStatus = "pending" | "processing" | "dispatching";

export interface ClientUpcomingMessageTriggerJob {
  id: string;
  ruleName: string;
  templateKey: TriggerTemplateKey;
  scheduledFor: string;
  nextAttemptAt: string | null;
  effectiveDueAt: string;
  status: ClientUpcomingMessageTriggerJobStatus;
  recipientType: TriggerRecipientType;
  recipientName: string | null;
}

export interface ClientUpcomingMessageTriggerJobsResponse {
  items: ClientUpcomingMessageTriggerJob[];
  nextCursor: string | null;
}
