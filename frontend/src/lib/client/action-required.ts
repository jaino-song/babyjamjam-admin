import type { Client } from "@/lib/client/types";

export const ACTION_REQUIRED_SIGNATURE_THRESHOLD_DAYS = 2;
export const ACTION_REQUIRED_SEND_THRESHOLD_DAYS = 6;

export type ActionRequiredReason =
  | "교체 요청"
  | "서명 필요"
  | "발송 필요";

export interface ActionRequiredStatus {
  reason: ActionRequiredReason;
  priority: 1 | 2 | 3;
}

function getNormalizedToday(referenceDate: Date) {
  const date = new Date(referenceDate);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getDaysUntilStartDate(startDate: string | null, referenceDate = new Date()) {
  if (!startDate) {
    return null;
  }

  const target = new Date(startDate);
  if (Number.isNaN(target.getTime())) {
    return null;
  }

  target.setHours(0, 0, 0, 0);
  const today = getNormalizedToday(referenceDate);

  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function getActionRequiredStatus(
  client: Client,
  referenceDate = new Date(),
): ActionRequiredStatus | null {
  if (client.serviceStatus === "replacement_requested") {
    return { reason: "교체 요청", priority: 1 };
  }

  if (client.serviceStatus === "completed" || client.serviceStatus === "terminated") {
    return null;
  }

  const daysUntilStart = getDaysUntilStartDate(client.startDate, referenceDate);
  if (daysUntilStart === null) {
    return null;
  }

  const isDocumentSent = Boolean(client.eDocId);
  if (!isDocumentSent && daysUntilStart <= ACTION_REQUIRED_SEND_THRESHOLD_DAYS) {
    return { reason: "발송 필요", priority: 3 };
  }

  if (isDocumentSent && client.documentStatus !== "completed" && daysUntilStart <= ACTION_REQUIRED_SIGNATURE_THRESHOLD_DAYS) {
    return { reason: "서명 필요", priority: 2 };
  }

  return null;
}
