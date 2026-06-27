import type {
  AlimtalkHistoryRecord,
  AlimtalkTriggerRule,
  TriggerEventType,
  TriggerRecipientType,
  TriggerTemplateCatalogItem,
  TriggerTemplateKey,
  UpcomingAlimtalkJob,
} from "./types";
// Single source of truth for a template's channel lives in the shared package so the form,
// channel filters, and the backend delivery drift guard all agree.
import {
  SMS_TRIGGER_TEMPLATE_KEYS,
  getTriggerTemplateChannel,
} from "@babyjamjam/shared/types/alimtalk";

export { SMS_TRIGGER_TEMPLATE_KEYS, getTriggerTemplateChannel };

export type TriggerMessageChannel = "sms" | "alimtalk";

export const SMS_HISTORY_PROVIDERS = ["aligo_sms"] as const;

export function isSmsTriggerTemplate(templateKey: string | null | undefined) {
  return SMS_TRIGGER_TEMPLATE_KEYS.includes(templateKey as TriggerTemplateKey);
}

export function isSmsHistoryProvider(provider: string | null | undefined) {
  return SMS_HISTORY_PROVIDERS.includes(provider as (typeof SMS_HISTORY_PROVIDERS)[number]);
}

export function isTriggerTemplateInChannel(
  templateKey: string | null | undefined,
  channel: TriggerMessageChannel,
) {
  const isSmsTemplate = isSmsTriggerTemplate(templateKey);
  return channel === "sms" ? isSmsTemplate : !isSmsTemplate;
}

export function isTriggerRuleInChannel(rule: AlimtalkTriggerRule, channel: TriggerMessageChannel) {
  return isTriggerTemplateInChannel(rule.templateKey, channel);
}

export function isUpcomingJobInChannel(job: UpcomingAlimtalkJob, channel: TriggerMessageChannel) {
  return isTriggerTemplateInChannel(job.templateKey, channel);
}

export function isSmsHistoryRecord(record: AlimtalkHistoryRecord) {
  return isSmsHistoryProvider(record.provider) || isSmsTriggerTemplate(record.templateKey);
}

export function isHistoryRecordInChannel(record: AlimtalkHistoryRecord, channel: TriggerMessageChannel) {
  const isSmsRecord = isSmsHistoryRecord(record);
  return channel === "sms" ? isSmsRecord : !isSmsRecord;
}

export function filterHistoryRecordsByChannel(
  records: AlimtalkHistoryRecord[],
  channel: TriggerMessageChannel,
) {
  return records.filter((record) => isHistoryRecordInChannel(record, channel));
}

// ---------------------------------------------------------------------------
// Catalog-driven option derivation (channel-generic).
//
// The trigger-rule form derives its 이벤트 기준 / 수신 대상 / 발송 템플릿 dropdowns from the
// template catalog returned by the backend, so a future SMS (or alimtalk) template appears
// automatically without editing hardcoded frontend lists. These pure helpers are the data
// transforms; the component layers presentation (label/icon/order) on top.
// ---------------------------------------------------------------------------

export function getChannelTemplates(
  templates: TriggerTemplateCatalogItem[],
  channel: TriggerMessageChannel,
): TriggerTemplateCatalogItem[] {
  return templates.filter((template) => getTriggerTemplateChannel(template.key) === channel);
}

export function deriveEventTypesFromTemplates(
  channelTemplates: TriggerTemplateCatalogItem[],
): TriggerEventType[] {
  const eventTypes = new Set<TriggerEventType>();
  for (const template of channelTemplates) {
    for (const eventType of template.allowedEventTypes) {
      eventTypes.add(eventType);
    }
  }
  return Array.from(eventTypes);
}

export function deriveRecipientTypesFromTemplates(
  channelTemplates: TriggerTemplateCatalogItem[],
  eventType: TriggerEventType,
): TriggerRecipientType[] {
  const recipientTypes = new Set<TriggerRecipientType>();
  for (const template of channelTemplates) {
    if (!template.allowedEventTypes.includes(eventType)) continue;
    for (const recipientType of template.allowedRecipientTypes) {
      recipientTypes.add(recipientType);
    }
  }
  return Array.from(recipientTypes);
}

export function deriveAvailableTemplates(
  channelTemplates: TriggerTemplateCatalogItem[],
  eventType: TriggerEventType,
  recipientType: TriggerRecipientType,
): TriggerTemplateCatalogItem[] {
  return channelTemplates.filter(
    (template) =>
      template.allowedEventTypes.includes(eventType) &&
      template.allowedRecipientTypes.includes(recipientType),
  );
}
