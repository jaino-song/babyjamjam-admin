"use client";
import {
  getUserErrorMessage,
  normalizeApiError,
  resolveProblemPresentation,
  type NormalizedApiError,
} from "@babyjamjam/shared";


import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Calendar, Loader2, Send, X } from "lucide-react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { filterHistoryRecordsByChannel } from "@/features/message-triggers/channel";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { useMessageHistory } from "@/features/message-triggers/hooks/use-message-triggers";
import type { MessageLogRecord } from "@/features/message-triggers/types";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useToast } from "@/hooks/use-toast";
import { messageDeliveryApi } from "@/services/api";
import type { Client } from "@/lib/client/types";
import {
  formatKoreanPhoneNumber,
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneLookupKey,
} from "@/lib/phone";
import {
  getLmsTitle,
  getTextByteLength,
  MAX_BODY_LENGTH,
  MAX_LMS_TITLE_BYTES,
  SMS_BYTE_LIMIT,
} from "@/lib/message/byte-length";
import { cn } from "@/lib/utils";
import { useFormStore } from "@/stores/form-store";
import { ContactInput } from "./form-components/ContactInput";
import { TemplateFieldGrid, TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import type {
  ServiceRecordLinkPreparation,
  TemplateMessageDeliveryMode,
} from "./form-components/TemplateMessageFormLayout";

const DUPLICATE_SEND_WINDOW_HOURS = 72;
const DUPLICATE_SEND_WINDOW_MS = DUPLICATE_SEND_WINDOW_HOURS * 60 * 60 * 1000;

type ServiceRecordLinkFailureStage = "assignment" | "send";

const SERVICE_RECORD_LINK_ERROR_MESSAGES: Record<string, string> = {
  "Assignment not found": "선택한 관리사님과 산모님의 배정 일정을 찾지 못해 제공기록지 링크를 보내지 못했어요",
  "제공인력 전화번호가 없습니다": "선택한 관리사님의 전화번호가 없어 제공기록지 링크를 보내지 못했어요",
  "준비된 제공기록지 링크가 만료되었거나 유효하지 않아요": "제공기록지 링크가 만료됐어요. 입력 정보를 다시 선택해 새 링크를 준비해 주세요",
};

export interface TemplateSendFormSubmitState {
  formId: string;
  isSending: boolean;
  isSubmitDisabled: boolean;
}

interface RecipientQueueItem {
  id: string;
  clientId: number | null;
  name: string;
  phone: string;
  formattedPhone: string;
  message: string;
}

interface DuplicateSendMatch {
  recipient: RecipientQueueItem;
  record: MessageLogRecord;
}

type SmsAttemptClassification = "accepted" | "not-applied" | "blocked";

interface SmsAttemptResult {
  recipient: RecipientQueueItem;
  classification: SmsAttemptClassification;
  normalized?: NormalizedApiError;
}

interface SmsSubmissionSnapshot {
  recipients: RecipientQueueItem[];
  templateId: string;
  templateName: string;
  message: string;
  requiresRecipientName: boolean;
}

type SubmissionGuard = "idle" | "checking" | "awaiting-confirm" | "sending";

interface TemplateSendFormProps {
  templateId: string;
  templateName: string;
  message: string;
  requiresRecipientName?: boolean;
  deliveryMode?: TemplateMessageDeliveryMode;
  children?: ReactNode;
  className?: string;
  formId?: string;
  showSubmitButton?: boolean;
  serviceRecordLinkPreparation?: ServiceRecordLinkPreparation | null;
  onSubmitStateChange?: (state: TemplateSendFormSubmitState | null) => void;
}

function getClientDurationInDays(client: Client) {
  if (client.duration == null) return "";
  return String(client.duration);
}

function usesInlinePhoneRecipientLayout(templateId: string) {
  return templateId === "builtin:greeting" || templateId === "builtin:info";
}

function normalizeDuplicateMessage(message: string) {
  return message.replace(/\r\n/g, "\n").trim();
}

function getServiceRecordLinkErrorMessage(
  error: unknown,
  failureStage: ServiceRecordLinkFailureStage,
): string {
  const stageFallback = failureStage === "assignment"
    ? "산모님의 배정 정보를 불러오지 못해 제공기록지 링크를 보내지 못했어요"
    : "서버가 제공기록지 링크 발송 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요";

  if (!isAxiosError<{ message?: unknown; error?: unknown }>(error)) return stageFallback;
  if (!error.response) {
    return "서버에 연결하지 못해 제공기록지 링크를 보내지 못했어요";
  }

  const payload = error.response.data;
  const apiMessage = payload && typeof payload === "object"
    ? payload.message ?? payload.error
    : null;
  if (typeof apiMessage === "string") {
    const knownMessage = SERVICE_RECORD_LINK_ERROR_MESSAGES[apiMessage.trim()];
    if (knownMessage) return knownMessage;
  }

  if (error.response.status === 401) {
    return "로그인이 만료돼서 제공기록지 링크를 보내지 못했어요";
  }
  if (error.response.status === 403) {
    return "선택한 배정 일정을 처리할 권한이 없어 제공기록지 링크를 보내지 못했어요";
  }
  if (error.response.status === 404) {
    return "선택한 관리사님과 산모님의 배정 일정을 찾지 못해 제공기록지 링크를 보내지 못했어요";
  }

  return stageFallback;
}

function getHistoryTimestamp(record: MessageLogRecord) {
  return record.lastAttemptAt ?? record.updatedAt ?? record.createdAt;
}

export function formatDuplicateSentAt(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const period = date.getHours() < 12 ? "오전" : "오후";
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${month}. ${day} ${period} ${hour}:${minute}`;
}

export function findRecentDuplicateSend(
  history: MessageLogRecord[],
  params: {
    receiver: string;
    message: string;
    now?: Date;
  },
) {
  const receiver = normalizeKoreanPhoneLookupKey(params.receiver);
  const message = normalizeDuplicateMessage(params.message);
  if (!receiver || !message) return null;

  const now = params.now ?? new Date();
  const threshold = now.getTime() - DUPLICATE_SEND_WINDOW_MS;

  return history
    .filter((record) => {
      if (record.status !== "sent") return false;
      if (normalizeKoreanPhoneLookupKey(record.recipientPhone ?? record.receiver) !== receiver) return false;
      if (normalizeDuplicateMessage(record.messageBody) !== message) return false;

      const sentAt = new Date(getHistoryTimestamp(record));
      return !Number.isNaN(sentAt.getTime()) && sentAt.getTime() >= threshold;
    })
    .sort((left, right) => {
      return new Date(getHistoryTimestamp(right)).getTime() - new Date(getHistoryTimestamp(left)).getTime();
    })[0] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStrictSmsSuccess(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.result)) return false;

  const { resultCode, successCount, errorCount } = value.result;
  return typeof resultCode === "number"
    && Number.isInteger(resultCode)
    && resultCode === 1
    && typeof successCount === "number"
    && Number.isInteger(successCount)
    && successCount === 1
    && typeof errorCount === "number"
    && Number.isInteger(errorCount)
    && errorCount === 0;
}

function normalizeSmsFailure(error: unknown): NormalizedApiError {
  return normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
}

function normalizeMalformedSmsResponse(value: unknown): NormalizedApiError {
  return normalizeSmsFailure({ response: { status: 200, data: value } });
}

function withSmsStatusCheckGuidance(message: string): string {
  const guidance = resolveProblemPresentation("ko-KR").checkStatus;
  return message.includes(guidance) ? message : `${message} ${guidance}`;
}

function recipientsMatch(left: RecipientQueueItem[], right: RecipientQueueItem[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    if (!other) return false;
    return item.id === other.id
      && item.clientId === other.clientId
      && item.name === other.name
      && item.phone === other.phone
      && item.formattedPhone === other.formattedPhone
      && item.message === other.message;
  });
}

export function TemplateSendForm({
  templateId,
  templateName,
  message,
  requiresRecipientName = false,
  deliveryMode = "sms",
  children,
  className,
  formId,
  showSubmitButton = true,
  serviceRecordLinkPreparation,
  onSubmitStateChange,
}: TemplateSendFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
    requestId?: string;
  } | null>(null);
  const [duplicateSendCandidates, setDuplicateSendCandidates] = useState<DuplicateSendMatch[] | null>(null);
  const [recipientQueue, setRecipientQueue] = useState<RecipientQueueItem[]>([]);
  const [smsOutcomeLocked, setSmsOutcomeLocked] = useState(false);
  const submissionGuardRef = useRef<SubmissionGuard>("idle");
  const duplicateSubmissionRef = useRef<SmsSubmissionSnapshot | null>(null);
  const mountedRef = useRef(true);
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const smsOutcomeLockedRef = useRef(false);
  const smsLockedFeedbackRef = useRef<typeof feedback>(null);
  const acceptedCurrentPhoneRef = useRef<string | null>(null);
  const latestSmsSnapshotRef = useRef<SmsSubmissionSnapshot | null>(null);
  const { data: historyData = [], refetch: refetchHistory } = useMessageHistory();
  const {
    clientId,
    name,
    phone,
    employeeId,
    employeeName,
    employeePhone,
    voucherType,
    voucherDuration,
    voucherYear,
    area,
    setActualPrice,
    setAddress,
    setArea,
    setBirthday,
    setClientId,
    setDueDate,
    setEndDate,
    setFullPrice,
    setGrant,
    setName,
    setPhone,
    setStartDate,
    setVoucherDuration,
    setVoucherType,
    resetClientFields,
    resetEmployeeFields,
  } = useFormStore();

  const isServiceRecordLinkDelivery = deliveryMode === "service-feedback-link";
  const recipientPhone = useMemo(
    () => normalizeKoreanPhoneLookupKey(phone),
    [phone],
  );
  const smsHistoryData = useMemo(
    () => filterHistoryRecordsByChannel(historyData, "sms"),
    [historyData],
  );
  const formattedRecipientPhone = recipientPhone ? formatKoreanPhoneNumber(recipientPhone) : "";
  const normalizedEmployeePhone = normalizeKoreanPhoneLookupKey(employeePhone);
  const recipientName = name.trim();
  const trimmedMessage = message.trim();
  const isBodyTooLong = trimmedMessage.length > MAX_BODY_LENGTH;
  const isRecipientValid = recipientPhone ? isValidKoreanPhoneNumber(recipientPhone) : false;
  const shouldUseInlinePhoneRecipient = !requiresRecipientName && usesInlinePhoneRecipientLayout(templateId);
  const shouldShowRecipientNameInPill = requiresRecipientName || shouldUseInlinePhoneRecipient;
  const requiresPriceInfoFields = templateId === "builtin:price-info";
  const recipientValidationMessage = requiresRecipientName && !recipientName
    ? "산모님 성함을 입력하거나 기존 고객을 선택해 주세요"
    : !recipientPhone
      ? "휴대 전화번호를 입력해 주세요"
    : !isRecipientValid
      ? "휴대 전화번호 형식이 올바르지 않아요"
      : null;
  const templateFieldValidationMessage = requiresPriceInfoFields && !voucherType
    ? "바우처 유형을 선택해 주세요"
    : requiresPriceInfoFields && !voucherDuration
      ? "서비스 기간을 선택해 주세요"
      : requiresPriceInfoFields && !area
        ? "지역을 선택해 주세요"
        : requiresPriceInfoFields && !voucherYear
          ? "바우처 연도를 선택해 주세요"
          : null;
  const serviceRecordValidationMessage = employeeId === null || !employeeName.trim()
    ? "관리사님을 선택해 주세요"
    : !normalizedEmployeePhone
      ? "관리사님 전화번호를 선택해 주세요"
      : !isValidKoreanPhoneNumber(normalizedEmployeePhone)
        ? "관리사님 전화번호 형식이 올바르지 않아요"
        : clientId === null
          ? "산모님을 선택해 주세요"
          : null;
  const messageValidationMessage = !trimmedMessage
    ? "메시지 본문을 입력해 주세요"
    : isBodyTooLong
      ? `본문은 최대 ${MAX_BODY_LENGTH}자까지 입력할 수 있어요`
      : null;
  const currentQueueItem = useMemo<RecipientQueueItem | null>(() => {
    if (isServiceRecordLinkDelivery) return null;
    if (acceptedCurrentPhoneRef.current === recipientPhone) return null;

    if (recipientValidationMessage || templateFieldValidationMessage || messageValidationMessage) {
      return null;
    }

    return {
      id: recipientPhone,
      clientId: selectedClientId,
      name: recipientName,
      phone: recipientPhone,
      formattedPhone: formattedRecipientPhone,
      message: trimmedMessage,
    };
  }, [
    formattedRecipientPhone,
    isServiceRecordLinkDelivery,
    messageValidationMessage,
    recipientName,
    recipientPhone,
    recipientValidationMessage,
    selectedClientId,
    templateFieldValidationMessage,
    trimmedMessage,
  ]);
  const hasQueuedRecipients = recipientQueue.length > 0;
  const validationMessage = isServiceRecordLinkDelivery
    ? serviceRecordValidationMessage
    : hasQueuedRecipients
      ? null
      : recipientValidationMessage ?? templateFieldValidationMessage ?? messageValidationMessage;
  const isSubmitDisabled = Boolean(validationMessage)
    || (isServiceRecordLinkDelivery && !serviceRecordLinkPreparation)
    || isSending
    || isCheckingDuplicate
    || (!isServiceRecordLinkDelivery && smsOutcomeLocked);
  const resolvedFormId = formId ?? `messages-template-send-form-${templateId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submissionGuardRef.current = "idle";
    };
  }, []);

  useEffect(() => {
    if (isServiceRecordLinkDelivery || feedback?.tone !== "error") return;

    const timer = window.setTimeout(() => {
      feedbackRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [feedback, isServiceRecordLinkDelivery]);

  useEffect(() => {
    if (!isServiceRecordLinkDelivery && smsOutcomeLockedRef.current && smsLockedFeedbackRef.current && feedback !== smsLockedFeedbackRef.current) setFeedback(smsLockedFeedbackRef.current);
  }, [feedback, isServiceRecordLinkDelivery]);

  const clearFeedbackUnlessSmsLocked = () => {
    if (!smsOutcomeLockedRef.current) {
      setFeedback(null);
    }
  };

  const lockSmsOutcome = () => {
    if (!smsOutcomeLockedRef.current) {
      smsOutcomeLockedRef.current = true;
      setSmsOutcomeLocked(true);
    }
  };

  useEffect(() => {
    if (!currentQueueItem) return;

    setRecipientQueue((currentQueue) => {
      const existingIndex = currentQueue.findIndex((item) => item.phone === currentQueueItem.phone);

      if (existingIndex === -1) {
        return [...currentQueue, currentQueueItem];
      }

      // For requiresRecipientName templates, update the queued entry in place so
      // a name correction always propagates (instead of being silently dropped).
      // For phone-only templates, the phone is the full identity — skip as before.
      if (requiresRecipientName) {
        const updated = [...currentQueue];
        updated[existingIndex] = currentQueueItem;
        return updated;
      }

      return currentQueue;
    });
  }, [currentQueueItem, requiresRecipientName]);

  useEffect(() => {
    onSubmitStateChange?.({
      formId: resolvedFormId,
      isSending,
      isSubmitDisabled,
    });
  }, [isSending, isSubmitDisabled, onSubmitStateChange, resolvedFormId]);

  const syncClientToTemplateForm = (client: Client) => {
    setClientId(client.id);
    setName(client.name);
    setPhone(client.phone ?? "");
    setBirthday(client.birthday ?? "");
    setDueDate(client.dueDate ?? "");
    setAddress(client.address ?? "");
    setStartDate(client.startDate ?? "");
    setEndDate(client.endDate ?? "");
    setFullPrice(client.fullPrice ?? "");
    setGrant(client.grant ?? "");
    setActualPrice(client.actualPrice ?? "");
    setVoucherType(client.type ?? "");
    setVoucherDuration(getClientDurationInDays(client));
    setArea(client.areaId ?? "");
  };

  const handleRecipientChange = (clientId: number | null, client: Client | null) => {
    acceptedCurrentPhoneRef.current = null;
    setSelectedClientId(clientId);
    clearFeedbackUnlessSmsLocked();

    if (!client) {
      setClientId(null);
      return;
    }

    syncClientToTemplateForm(client);
  };

  const handleManualRecipientNameChange = (value: string) => {
    acceptedCurrentPhoneRef.current = null;
    setSelectedClientId(null);
    setClientId(null);
    setName(value);
    clearFeedbackUnlessSmsLocked();
  };

  const handlePhoneChange = (value: string) => {
    acceptedCurrentPhoneRef.current = null;
    setSelectedClientId(null);
    setClientId(null);
    setPhone(value);
    if (!requiresRecipientName) {
      setName("");
    }
    clearFeedbackUnlessSmsLocked();
  };

  const handleClearRecipient = ({ clearFeedback = true }: { clearFeedback?: boolean } = {}) => {
    acceptedCurrentPhoneRef.current = null;
    setSelectedClientId(null);
    setClientId(null);
    setName("");
    setPhone("");
    if (clearFeedback) {
      clearFeedbackUnlessSmsLocked();
    }
  };

  const handleRemoveQueuedRecipient = (itemToRemove: RecipientQueueItem) => {
    setRecipientQueue((currentQueue) => currentQueue.filter((item) => item.id !== itemToRemove.id));

    if (itemToRemove.phone === recipientPhone) {
      handleClearRecipient();
    }
  };

  const recipientPills = recipientQueue.length > 0 ? (
    <div
      data-component="desktop_messages_sections_template-send-form-recipient-queue"
      className="flex flex-wrap gap-2"
    >
      {recipientQueue.map((item) => (
        <StatusBadge
          key={item.id}
          data-component="desktop_messages_sections_template-send-form-recipient"
          variant="primary"
          size="sm"
          className="w-fit max-w-none justify-start"
        >
          <span className="min-w-0 truncate">
            {shouldShowRecipientNameInPill && item.name
              ? `${item.name} · ${item.formattedPhone}`
              : item.formattedPhone}
          </span>
          <button
            type="button"
            className="flex h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-full text-v3-primary/70 transition-colors hover:text-v3-primary"
            aria-label="수신자 제거"
            onClick={() => handleRemoveQueuedRecipient(item)}
          >
            <X aria-hidden="true" />
          </button>
        </StatusBadge>
      ))}
    </div>
  ) : null;

  const phoneAutocompleteField = (
    <ClientAutocomplete
      data-component="desktop_messages_sections_template-send-form_phone-autocomplete"
      value={selectedClientId}
      onChange={handleRecipientChange}
      label="휴대 전화번호"
      required
      placeholder="연락처 검색 또는 직접 입력"
      manualValue={phone}
      onManualValueChange={handlePhoneChange}
      displayValueMode="phone"
      searchMode="phone"
    />
  );

  const getRecipientsForSubmit = () => {
    if (recipientQueue.length > 0) {
      const queuedRecipients = acceptedCurrentPhoneRef.current
        ? recipientQueue.filter((item) => item.phone !== acceptedCurrentPhoneRef.current)
        : recipientQueue;
      if (currentQueueItem && !queuedRecipients.some((item) => item.phone === currentQueueItem.phone)) {
        return [...queuedRecipients, currentQueueItem];
      }

      return queuedRecipients;
    }

    if (currentQueueItem) return [currentQueueItem];

    return [];
  };

  latestSmsSnapshotRef.current = {
    recipients: getRecipientsForSubmit().map((recipient) => ({ ...recipient })),
    templateId,
    templateName,
    message,
    requiresRecipientName,
  };

  const sendMessages = async (recipients: RecipientQueueItem[]) => {
    if (smsOutcomeLockedRef.current) {
      submissionGuardRef.current = "idle";
      return;
    }
    if (recipients.length === 0 || validationMessage) {
      setFeedback({ tone: "error", message: validationMessage ?? "발송할 수신자 정보를 입력해 주세요." });
      submissionGuardRef.current = "idle";
      return;
    }

    setIsSending(true);
    setFeedback(null);
    setDuplicateSendCandidates(null);
    const submittedSnapshot = createSmsSubmissionSnapshot(recipients);

    try {
      const settled = await Promise.allSettled(
        recipients.map((recipient) => (
          messageDeliveryApi.sendSms({
            receiver: recipient.formattedPhone,
            message: recipient.message,
            msgType: "AUTO",
            triggerType: "immediate",
            ...(recipient.clientId ? { clientId: recipient.clientId } : {}),
            ...(requiresRecipientName && recipient.name ? { recipientName: recipient.name } : {}),
            ...(getTextByteLength(recipient.message) > SMS_BYTE_LIMIT ? { title: getLmsTitle(templateName) } : {}),
          })
        )),
      );

      if (!mountedRef.current) return;

      const attempts: SmsAttemptResult[] = settled.map((result, index) => {
        const recipient = recipients[index];
        if (result.status === "fulfilled") {
          return isStrictSmsSuccess(result.value)
            ? { recipient, classification: "accepted" }
            : {
                recipient,
                classification: "blocked",
                normalized: normalizeMalformedSmsResponse(result.value),
              };
        }

        const normalized = normalizeSmsFailure(result.reason);
        return {
          recipient,
          classification: normalized.verified && normalized.outcome === "NOT_APPLIED"
            ? "not-applied"
            : "blocked",
          normalized,
        };
      });

      const acceptedRecipients = attempts
        .filter((attempt) => attempt.classification === "accepted")
        .map((attempt) => attempt.recipient);
      const notAppliedAttempts = attempts.filter((attempt) => attempt.classification === "not-applied");
      const blockedAttempts = attempts.filter((attempt) => attempt.classification === "blocked");
      const acceptedPhones = new Set(acceptedRecipients.map((recipient) => recipient.phone));
      const submissionStillCurrent = isSmsSubmissionSnapshotCurrent(submittedSnapshot);

      setRecipientQueue((currentQueue) =>
        currentQueue.filter((item) => !acceptedRecipients.some((recipient) => recipientsMatch([recipient], [item]))),
      );
      if (submissionStillCurrent && acceptedPhones.has(recipientPhone)) {
        handleClearRecipient({ clearFeedback: false });
        acceptedCurrentPhoneRef.current = recipientPhone;
      }

      if (blockedAttempts.length > 0) {
        lockSmsOutcome();
        const firstBlocked = blockedAttempts[0]?.normalized;
        const safeFailureMessage = withSmsStatusCheckGuidance(
          firstBlocked?.message ?? "문자 발송 결과를 확인할 수 없어요.",
        );
        const acceptedSummary = acceptedRecipients.length > 0
          ? `${acceptedRecipients.length}건 발송 요청을 접수했어요. `
          : "";
        smsLockedFeedbackRef.current = {
          tone: "error",
          message: `${acceptedSummary}${safeFailureMessage}`,
          requestId: firstBlocked?.problem?.requestId,
        };
        setFeedback(smsLockedFeedbackRef.current);
      } else if (notAppliedAttempts.length > 0) {
        const firstNotApplied = notAppliedAttempts[0]?.normalized;
        const acceptedSummary = acceptedRecipients.length > 0
          ? `${acceptedRecipients.length}건 발송 요청을 접수했어요. `
          : "";
        setFeedback({
          tone: "error",
          message: `${acceptedSummary}${firstNotApplied?.message ?? "입력 내용을 확인해 주세요."} 수정한 뒤 다시 시도해 주세요.`,
          requestId: firstNotApplied?.problem?.requestId,
        });
      } else {
        setFeedback({ tone: "success", message: `메시지 발송 요청 ${acceptedRecipients.length}건을 접수했어요` });
        if (submissionStillCurrent) {
          setRecipientQueue([]);
          handleClearRecipient({ clearFeedback: false });
        }
      }
    } finally {
      duplicateSubmissionRef.current = null;
      submissionGuardRef.current = "idle";
      if (mountedRef.current) {
        setIsSending(false);
      }
    }
  };

  const findDuplicateBeforeSend = async (recipients: RecipientQueueItem[]): Promise<DuplicateSendMatch[]> => {
    setIsCheckingDuplicate(true);
    try {
      const result = await refetchHistory();
      const latestHistory = filterHistoryRecordsByChannel(result.data ?? historyData, "sms");

      const matches: DuplicateSendMatch[] = [];
      for (const recipient of recipients) {
        const record = findRecentDuplicateSend(latestHistory, {
          receiver: recipient.formattedPhone,
          message: recipient.message,
        });
        if (record) matches.push({ recipient, record });
      }
      return matches;
    } catch (error) {
      const normalized = normalizeSmsFailure(error);
      if (normalized.canceled) {
        throw error;
      }
      const matches: DuplicateSendMatch[] = [];
      for (const recipient of recipients) {
        const record = findRecentDuplicateSend(smsHistoryData, {
          receiver: recipient.formattedPhone,
          message: recipient.message,
        });
        if (record) matches.push({ recipient, record });
      }
      return matches;
    } finally {
      setIsCheckingDuplicate(false);
    }
  };

  const createSmsSubmissionSnapshot = (recipients: RecipientQueueItem[]): SmsSubmissionSnapshot => ({
    recipients: recipients.map((recipient) => ({ ...recipient })),
    templateId,
    templateName,
    message,
    requiresRecipientName,
  });

  const isSmsSubmissionSnapshotCurrent = (snapshot: SmsSubmissionSnapshot) => {
    const latest = latestSmsSnapshotRef.current;
    return latest !== null
      && snapshot.templateId === latest.templateId
      && snapshot.templateName === latest.templateName
      && snapshot.message === latest.message
      && snapshot.requiresRecipientName === latest.requiresRecipientName
      && recipientsMatch(snapshot.recipients, latest.recipients);
  };

  const sendServiceRecordLink = async () => {
    if (clientId === null || employeeId === null || !serviceRecordLinkPreparation) {
      const errorMessage =
        serviceRecordValidationMessage ??
        "제공기록지 링크를 준비하고 있어요. 잠시 후 다시 시도해 주세요";
      setFeedback({ tone: "error", message: errorMessage });
      toast({ variant: "destructive", description: getUserErrorMessage(errorMessage) });
      return;
    }

    setIsSending(true);
    setFeedback(null);
    const failureStage: ServiceRecordLinkFailureStage = "send";

    try {
      const response = await serviceRecordsApi.sendLink(serviceRecordLinkPreparation.scheduleId, {
        preparedLinkToken: serviceRecordLinkPreparation.preparedLinkToken,
        recipientPhone: serviceRecordLinkPreparation.recipientPhone,
      });
      const { status } = response.data;

      if (status === "sent") {
        setFeedback({ tone: "success", message: "제공기록지 링크를 바로 보냈어요" });
        toast({ variant: "success", description: "제공기록지 링크를 바로 보냈어요" });
        resetEmployeeFields();
        resetClientFields();
      } else if (status === "processing") {
        setFeedback({ tone: "success", message: "제공기록지 링크를 보내고 있어요" });
        toast({ description: "제공기록지 링크를 보내고 있어요" });
      } else {
        const errorMessage =
          status === "pending"
            ? "바로 보내지 못해 재시도 대기열에 넣었어요"
            : "제공기록지 링크를 바로 보내지 못했어요";
        setFeedback({ tone: "error", message: errorMessage });
        toast({ variant: "destructive", description: getUserErrorMessage(errorMessage) });
      }
    } catch (error) {
      const errorMessage = getServiceRecordLinkErrorMessage(error, failureStage);
      setFeedback({ tone: "error", message: errorMessage });
      toast({ variant: "destructive", description: getUserErrorMessage(errorMessage) });
    } finally {
      void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
      void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() });
      setIsSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!mountedRef.current) return;
    if (
      !isServiceRecordLinkDelivery
      && (submissionGuardRef.current !== "idle" || smsOutcomeLockedRef.current)
    ) {
      return;
    }

    if (validationMessage) {
      setFeedback({ tone: "error", message: validationMessage });
      if (isServiceRecordLinkDelivery) {
        toast({ variant: "destructive", description: getUserErrorMessage(validationMessage) });
      }
      return;
    }

    if (isServiceRecordLinkDelivery) {
      await sendServiceRecordLink();
      return;
    }

    const recipients = getRecipientsForSubmit();
    if (recipients.length === 0) {
      setFeedback({ tone: "error", message: "발송할 수신자 정보를 입력해 주세요." });
      return;
    }

    const snapshot = createSmsSubmissionSnapshot(recipients);
    submissionGuardRef.current = "checking";
    let duplicates: DuplicateSendMatch[];
    try {
      duplicates = await findDuplicateBeforeSend(snapshot.recipients);
    } catch (error) {
      submissionGuardRef.current = "idle";
      if (!normalizeSmsFailure(error).canceled) {
        setFeedback({
          tone: "error",
          message: withSmsStatusCheckGuidance("중복 발송 여부를 확인하지 못했어요."),
        });
      }
      return;
    }

    if (!mountedRef.current || submissionGuardRef.current !== "checking") {
      if (mountedRef.current) submissionGuardRef.current = "idle";
      return;
    }
    if (!isSmsSubmissionSnapshotCurrent(snapshot)) {
      submissionGuardRef.current = "idle";
      return;
    }

    if (duplicates.length > 0) {
      setFeedback(null);
      setDuplicateSendCandidates(duplicates);
      duplicateSubmissionRef.current = snapshot;
      submissionGuardRef.current = "awaiting-confirm";
      return;
    }

    submissionGuardRef.current = "sending";
    await sendMessages(snapshot.recipients);
  };

  const handleConfirmDuplicateSend = async () => {
    if (!mountedRef.current || submissionGuardRef.current !== "awaiting-confirm") return;

    const snapshot = duplicateSubmissionRef.current;
    if (!snapshot || !isSmsSubmissionSnapshotCurrent(snapshot)) {
      duplicateSubmissionRef.current = null;
      setDuplicateSendCandidates(null);
      submissionGuardRef.current = "idle";
      setFeedback({ tone: "error", message: "입력 내용이 변경되어 전송 확인을 다시 진행해 주세요." });
      return;
    }

    submissionGuardRef.current = "sending";
    await sendMessages(snapshot.recipients);
  };

  return (
    <form
      id={resolvedFormId}
      data-component="desktop_messages_sections_template-send-form"
      data-template-id={templateId}
      className={cn("flex min-h-0 flex-col gap-4 rounded-[20px] bg-v3-dim-white p-5", className)}
      onSubmit={handleSubmit}
    >
      <div data-component="desktop_messages_sections_template-send-form_header" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[calc(14.4px*var(--glint-ui-scale,1))] font-bold text-v3-dark">전송 정보</h3>
          <p className="mt-0.5 text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted">
            메시지 전송에 필요한 정보를 입력해 주세요.
          </p>
        </div>
        {showSubmitButton ? (
          <Button
            type="submit"
            disabled={isSubmitDisabled}
            className="shrink-0"
          >
            {isSending || isCheckingDuplicate ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSending ? "발송 중…" : isCheckingDuplicate ? "확인 중…" : "즉시 발송"}
          </Button>
        ) : null}
      </div>

      {isServiceRecordLinkDelivery ? (
        children ? <TemplateFieldGrid layout="stack">{children}</TemplateFieldGrid> : null
      ) : shouldUseInlinePhoneRecipient ? (
        <>
          <div
            data-component="desktop_messages_sections_template-send-form_phone-field"
            className="min-w-0 w-full"
          >
            {templateId === "builtin:greeting" ? (
              <ContactInput
                phone={phone}
                setPhone={handlePhoneChange}
                label="휴대 전화번호"
                placeholder="010-0000-0000"
                required
              />
            ) : phoneAutocompleteField}
          </div>
          {children ? <TemplateFieldGrid layout="stack">{children}</TemplateFieldGrid> : null}
        </>
      ) : (
        <TemplateFieldGrid layout="stack">
          {requiresRecipientName ? (
            <>
              <TemplateFieldGridItem dataComponent="desktop_messages_sections_template-send-form_recipient-field">
                <ClientAutocomplete
                  data-component="desktop_messages_sections_template-send-form_recipient-field_autocomplete"
                  value={selectedClientId}
                  onChange={handleRecipientChange}
                  label="산모님 성함"
                  required
                  placeholder="새로 입력 또는 기존 고객 선택"
                  manualValue={name}
                  onManualValueChange={handleManualRecipientNameChange}
                />
              </TemplateFieldGridItem>

              <TemplateFieldGridItem dataComponent="desktop_messages_sections_template-send-form_phone-field">
                <ContactInput
                  phone={phone}
                  setPhone={handlePhoneChange}
                  label="휴대 전화번호"
                  placeholder="010-0000-0000"
                  required
                />
              </TemplateFieldGridItem>
            </>
          ) : (
            <TemplateFieldGridItem dataComponent="desktop_messages_sections_template-send-form_phone-field">
              {phoneAutocompleteField}
            </TemplateFieldGridItem>
          )}

          {children}
        </TemplateFieldGrid>
      )}

      {isServiceRecordLinkDelivery ? null : recipientPills}

      {feedback ? (
        <div
          ref={feedbackRef}
          data-component="desktop_messages_sections_template-send-form_feedback"
          className={cn(
            "mt-4 rounded-[14px] px-4 py-3 text-[calc(12.48px*var(--glint-ui-scale,1))] font-semibold",
            feedback.tone === "success"
              ? "bg-v3-primary-light text-v3-primary"
              : "bg-v3-burgundy-light text-v3-burgundy",
          )}
          role="status"
          tabIndex={feedback.tone === "error" ? -1 : undefined}
        >
          {feedback.message}
          {feedback.requestId ? (
            <span
              data-component="desktop_messages_sections_template-send-form_feedback_request-id"
              className="mt-1 block text-[0.72rem] font-medium"
            >
              요청 ID: {feedback.requestId}
            </span>
          ) : null}
        </div>
      ) : null}

      <TwoButtonModal
        open={Boolean(duplicateSendCandidates && duplicateSendCandidates.length > 0)}
        size="detail"
        onOpenChange={(open) => {
          if (!open) {
            setDuplicateSendCandidates(null);
            duplicateSubmissionRef.current = null;
            if (submissionGuardRef.current === "awaiting-confirm") {
              submissionGuardRef.current = "idle";
            }
          }
        }}
        dataComponent="desktop_messages_sections_duplicate-send-confirm-dialog"
        headerDataComponent="desktop_messages_sections_duplicate-send-confirm-dialog_header"
        bodyDataComponent="desktop_messages_sections_duplicate-send-confirm-dialog_main"
        footerDataComponent="desktop_messages_sections_duplicate-send-confirm-dialog_footer"
        title="중복 전송 확인"
        description={
          duplicateSendCandidates && duplicateSendCandidates.length > 1
            ? `최근 같은 내용의 메시지를 보낸 기록이 ${duplicateSendCandidates.length}건 있습니다. 동일한 메시지를 재전송 할까요?`
            : "최근 같은 내용의 메시지를 보낸 기록이 있습니다. 동일한 메시지를 재전송 할까요?"
        }
        isDescriptionVisuallyHidden={false}
        approvalLabel="전송"
        pendingLabel="전송 중..."
        isPending={isSending}
        onApprove={() => void handleConfirmDuplicateSend()}
      >
        {duplicateSendCandidates && duplicateSendCandidates.length > 0 ? (
          <div
            data-component="desktop_messages_sections_template-send-form_duplicate-send-confirm-list"
            className="flex flex-col gap-2"
          >
            {duplicateSendCandidates.map((match) => (
              <div
                key={match.recipient.phone}
                data-component="desktop_messages_sections_template-send-form_duplicate-send-confirm-list_recent"
                className="rounded-[16px] bg-v3-dim-white px-4 py-3"
              >
                {shouldShowRecipientNameInPill && match.recipient.name ? (
                  <p className="mb-1 truncate text-[0.78rem] font-semibold text-v3-dark">
                    {match.recipient.name} · {match.recipient.formattedPhone}
                  </p>
                ) : (
                  <p className="mb-1 truncate text-[0.78rem] font-semibold text-v3-dark">
                    {match.recipient.formattedPhone}
                  </p>
                )}
                <span className="flex min-w-0 shrink-0 items-center gap-[calc(4px*var(--glint-ui-scale,1))] text-[0.78rem] font-semibold text-v3-text-muted">
                  <Calendar className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] shrink-0" />
                  최근 전송 {formatDuplicateSentAt(getHistoryTimestamp(match.record))}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </TwoButtonModal>

    </form>
  );
}
