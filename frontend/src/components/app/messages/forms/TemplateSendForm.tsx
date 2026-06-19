"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Loader2, Send, X } from "lucide-react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { messageDeliveryApi } from "@/services/api";
import type { Client } from "@/lib/client/types";
import {
  formatKoreanPhoneNumber,
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneLookupKey,
} from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useFormStore } from "@/stores/form-store";
import { ContactInput } from "./form-components/ContactInput";
import { TemplateFieldGrid, TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";

const SMS_BYTE_LIMIT = 90;
const MAX_LMS_TITLE_BYTES = 44;
const MAX_BODY_LENGTH = 2000;
const DEFAULT_LMS_TITLE = "안내";

interface TemplateSendFormProps {
  templateId: string;
  templateName: string;
  message: string;
  requiresRecipientName?: boolean;
  children?: ReactNode;
}

function getTextByteLength(text: string) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }

  return Array.from(text).reduce((size, char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) return size + 1;
    if (codePoint <= 0x7ff) return size + 2;
    if (codePoint <= 0xffff) return size + 3;
    return size + 4;
  }, 0);
}

function getLmsTitle(templateName: string) {
  return getTextByteLength(templateName) <= MAX_LMS_TITLE_BYTES ? templateName : DEFAULT_LMS_TITLE;
}

function getClientDurationInDays(client: Client) {
  if (client.duration == null) return "";
  return String(client.duration);
}

function usesInlinePhoneRecipientLayout(templateId: string) {
  return templateId === "builtin:greeting" || templateId === "builtin:info";
}

export function TemplateSendForm({
  templateId,
  templateName,
  message,
  requiresRecipientName = false,
  children,
}: TemplateSendFormProps) {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const {
    name,
    phone,
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
  } = useFormStore();

  const recipientPhone = useMemo(
    () => normalizeKoreanPhoneLookupKey(phone),
    [phone],
  );
  const formattedRecipientPhone = recipientPhone ? formatKoreanPhoneNumber(recipientPhone) : "";
  const recipientName = name.trim();
  const trimmedMessage = message.trim();
  const isBodyTooLong = trimmedMessage.length > MAX_BODY_LENGTH;
  const isRecipientValid = recipientPhone ? isValidKoreanPhoneNumber(recipientPhone) : false;
  const shouldUseInlinePhoneRecipient = !requiresRecipientName && usesInlinePhoneRecipientLayout(templateId);
  const shouldShowRecipientNameInPill = requiresRecipientName || shouldUseInlinePhoneRecipient;
  const validationMessage = requiresRecipientName && !recipientName
    ? "산모님 성함을 입력하거나 기존 고객을 선택해 주세요."
    : !recipientPhone
      ? "휴대 전화번호를 입력해 주세요."
    : !isRecipientValid
      ? "휴대 전화번호 형식이 올바르지 않습니다."
      : !trimmedMessage
        ? "메시지 본문을 입력해 주세요."
        : isBodyTooLong
          ? `본문은 최대 ${MAX_BODY_LENGTH}자까지 입력할 수 있습니다.`
          : null;
  const isSubmitDisabled = Boolean(validationMessage) || isSending;

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
    setSelectedClientId(clientId);
    setFeedback(null);

    if (!client) {
      setClientId(null);
      return;
    }

    syncClientToTemplateForm(client);
  };

  const handleManualRecipientNameChange = (value: string) => {
    setSelectedClientId(null);
    setClientId(null);
    setName(value);
    setFeedback(null);
  };

  const handlePhoneChange = (value: string) => {
    setSelectedClientId(null);
    setClientId(null);
    setPhone(value);
    if (!requiresRecipientName) {
      setName("");
    }
    setFeedback(null);
  };

  const handleClearRecipient = ({ clearFeedback = true }: { clearFeedback?: boolean } = {}) => {
    setSelectedClientId(null);
    setClientId(null);
    setName("");
    setPhone("");
    if (clearFeedback) {
      setFeedback(null);
    }
  };

  const recipientPill = formattedRecipientPhone ? (
    <StatusBadge
      data-component="messages-template-send-form-recipient"
      variant="primary"
      size="sm"
      className="w-fit max-w-none justify-start"
    >
      <span className="min-w-0 truncate">
        {shouldShowRecipientNameInPill && recipientName
          ? `${recipientName} · ${formattedRecipientPhone}`
          : formattedRecipientPhone}
      </span>
      <button
        type="button"
        className="flex h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(12px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-full text-v3-primary/70 transition-colors hover:text-v3-primary"
        aria-label="수신자 제거"
        onClick={() => handleClearRecipient()}
      >
        <X aria-hidden="true" />
      </button>
    </StatusBadge>
  ) : null;

  const phoneAutocompleteField = (
    <ClientAutocomplete
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (validationMessage) {
      setFeedback({ tone: "error", message: validationMessage });
      return;
    }

    setIsSending(true);
    setFeedback(null);

    try {
      const response = await messageDeliveryApi.sendSms({
        receiver: formattedRecipientPhone,
        message: trimmedMessage,
        msgType: "AUTO",
        triggerType: "immediate",
        ...(selectedClientId ? { clientId: selectedClientId } : {}),
        ...(requiresRecipientName && recipientName ? { recipientName } : {}),
        ...(getTextByteLength(trimmedMessage) > SMS_BYTE_LIMIT ? { title: getLmsTitle(templateName) } : {}),
      });

      if (
        response.result &&
        (response.result.resultCode !== 1 || (response.result.errorCount ?? 0) > 0)
      ) {
        throw new Error(response.result.message ?? "발송에 실패했습니다.");
      }

      setFeedback({ tone: "success", message: "메시지 발송 요청이 접수되었습니다." });
      handleClearRecipient({ clearFeedback: false });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "발송에 실패했습니다.",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form
      data-component="messages-template-send-form"
      data-template-id={templateId}
      className="flex min-h-0 flex-col gap-4 rounded-[20px] bg-v3-dim-white p-5"
      onSubmit={handleSubmit}
    >
      <div data-component="messages-template-send-form-header" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[0.9rem] font-bold text-v3-dark">전송 정보</h3>
          <p className="mt-0.5 text-[0.75rem] text-v3-text-muted">
            모바일 전송 화면과 동일하게 수신 연락처를 확인한 뒤 바로 발송할 수 있습니다.
          </p>
        </div>
        <Button
          type="submit"
          disabled={isSubmitDisabled}
          className="shrink-0"
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          {isSending ? "발송 중..." : "즉시 발송"}
        </Button>
      </div>

      {shouldUseInlinePhoneRecipient ? (
        <>
          <div
            data-component="messages-template-send-form-inline-recipient-row"
            className="flex min-w-0 flex-wrap items-end gap-3"
          >
            <div
              data-component="messages-template-send-form-phone-field"
              className="min-w-0 w-[min(100%,max(10rem,calc((100%_-_2rem)_/_3)))]"
            >
              {phoneAutocompleteField}
            </div>
          </div>
          {children ? <TemplateFieldGrid>{children}</TemplateFieldGrid> : null}
        </>
      ) : (
        <TemplateFieldGrid>
          {requiresRecipientName ? (
            <>
              <TemplateFieldGridItem dataComponent="messages-template-send-form-recipient-field">
                <ClientAutocomplete
                  value={selectedClientId}
                  onChange={handleRecipientChange}
                  label="산모님 성함"
                  required
                  placeholder="새로 입력 또는 기존 고객 선택"
                  manualValue={name}
                  onManualValueChange={handleManualRecipientNameChange}
                />
              </TemplateFieldGridItem>

              <TemplateFieldGridItem dataComponent="messages-template-send-form-phone-field">
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
            <TemplateFieldGridItem dataComponent="messages-template-send-form-phone-field">
              {phoneAutocompleteField}
            </TemplateFieldGridItem>
          )}

          {children}
        </TemplateFieldGrid>
      )}

      {recipientPill}

      {feedback ? (
        <div
          data-component="messages-template-send-form-feedback"
          className={cn(
            "mt-4 rounded-[14px] px-4 py-3 text-[0.78rem] font-semibold",
            feedback.tone === "success"
              ? "bg-v3-primary-light text-v3-primary"
              : "bg-v3-burgundy-light text-v3-burgundy",
          )}
          role="status"
        >
          {feedback.message}
        </div>
      ) : null}

    </form>
  );
}
