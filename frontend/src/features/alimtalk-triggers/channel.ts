import type {
  AlimtalkHistoryRecord,
  AlimtalkTriggerRule,
  TriggerTemplateKey,
  UpcomingAlimtalkJob,
} from "./types";

export type TriggerMessageChannel = "sms" | "alimtalk";

export const SMS_TRIGGER_TEMPLATE_KEYS: TriggerTemplateKey[] = ["SERVICE_INFO"];
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
