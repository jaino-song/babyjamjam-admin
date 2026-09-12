"use client";

import { useEffect, useRef, useState } from "react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { Button } from "@/components/ui/button";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { eformsignApi } from "@/services/api";
import type { Employee } from "@/hooks/useEmployees";
import { t } from "@/lib/i18n/translations";
import { describeReceiptLinkError } from "@/lib/receipt-link";
import type { Client } from "@/lib/client/types";
import {
  isValidKoreanPhoneNumber,
  normalizeKoreanPhoneLookupKey,
} from "@/lib/phone";
import { useLocale } from "@/providers/LocaleProvider";
import { renderTemplate } from "@/lib/template-utils";
import { useFormStore } from "@/stores/form-store";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import { ContactInput } from "./form-components/ContactInput";
import { TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
  type ServiceRecordLinkPreparation,
  type ReceiptLinkPreparation,
} from "./form-components/TemplateMessageFormLayout";

interface ServiceRecordLinkMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
  mode?: "service-feedback-link" | "receipt-link";
}

const ALIGNED_AUTOCOMPLETE_CLASS_NAME =
  "grid gap-[calc(7px*var(--glint-ui-scale,1))] space-y-0";

interface PreparedServiceRecordLink extends ServiceRecordLinkPreparation {
  selectionKey: string;
}

interface PreparedReceiptLink extends ReceiptLinkPreparation {
  selectionKey: string;
}

export const ServiceRecordLinkMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
  mode = "service-feedback-link",
}: ServiceRecordLinkMessageFormProps) => {
  const locale = useLocale();
  const {
    clientId,
    name: clientName,
    phone: clientPhone,
    employeeId,
    employeeName,
    employeePhone,
    setClientId,
    setName: setClientName,
    setPhone: setClientPhone,
    setEmployeeSelection,
    setIsEmployeeManualEntry,
    setEmployeePhone,
    resetEmployeeFields,
  } = useFormStore();
  const {
    data: systemTemplate,
    isError: isSystemTemplateError,
    isFetching: isSystemTemplateFetching,
    isLoading: isSystemTemplateLoading,
  } = useSystemTemplate(
    mode === "receipt-link" ? "SERVICE_END_NOTICE" : "SERVICE_RECORD_LINK",
  );
  const templateReady = Boolean(
    systemTemplate?.content
    && !isSystemTemplateError
    && !isSystemTemplateFetching
    && !isSystemTemplateLoading,
  );
  const [preparedServiceRecordLink, setPreparedServiceRecordLink] = useState<PreparedServiceRecordLink | null>(null);
  const [preparedReceiptLink, setPreparedReceiptLink] = useState<PreparedReceiptLink | null>(null);
  const [receiptPreparationAttempt, setReceiptPreparationAttempt] = useState(0);
  const [preparationErrorKey, setPreparationErrorKey] = useState<string | null>(null);
  const [receiptPreparationError, setReceiptPreparationError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const inFlightPreparationRef = useRef<{
    selectionKey: string;
    promise: Promise<PreparedServiceRecordLink>;
  } | null>(null);
  const inFlightReceiptPreparationRef = useRef<{
    selectionKey: string;
    promise: Promise<PreparedReceiptLink>;
  } | null>(null);

  const normalizedEmployeePhone = normalizeKoreanPhoneLookupKey(employeePhone);
  const canPrepareServiceRecordLink = mode === "service-feedback-link"
    && clientId !== null
    && Boolean(clientName.trim())
    && employeeId !== null
    && Boolean(employeeName.trim())
    && isValidKoreanPhoneNumber(normalizedEmployeePhone);
  const selectionKey = canPrepareServiceRecordLink
    ? `${clientId}:${employeeId}:${normalizedEmployeePhone}`
    : null;
  const currentPreparation = preparedServiceRecordLink?.selectionKey === selectionKey
    ? preparedServiceRecordLink
    : null;

  const normalizedClientPhone = normalizeKoreanPhoneLookupKey(clientPhone);
  const canPrepareReceiptLink = mode === "receipt-link"
    && clientId !== null
    && Boolean(clientName.trim())
    && isValidKoreanPhoneNumber(normalizedClientPhone);
  // The selected client id is the identity pin. The backend returns the
  // authoritative name and phone; formatting those values must not trigger a
  // second preparation for the same client.
  const receiptSelectionKey = canPrepareReceiptLink && clientId !== null
    ? String(clientId)
    : null;
  const currentReceiptPreparation = preparedReceiptLink?.selectionKey === receiptSelectionKey
    ? preparedReceiptLink
    : null;

  useEffect(() => {
    if (selectionKey === null || clientId === null || employeeId === null) {
      return;
    }
    if (preparedServiceRecordLink?.selectionKey === selectionKey) {
      return;
    }

    let cancelled = false;

    const existingRequest = inFlightPreparationRef.current;
    const promise = existingRequest?.selectionKey === selectionKey
      ? existingRequest.promise
      : (async (): Promise<PreparedServiceRecordLink> => {
          const overviewResponse = await serviceRecordsApi.getClientOverview(clientId);
          const assignment = overviewResponse.data.assignments.find(
            (item) => !item.replaced && item.employee.id === employeeId,
          );
          if (!assignment) {
            throw new Error("Assignment not found");
          }

          const preparedResponse = await serviceRecordsApi.prepareLink(assignment.scheduleId, {
            recipientPhone: normalizedEmployeePhone,
          });
          return {
            scheduleId: assignment.scheduleId,
            serviceStartDate: assignment.startDate.slice(0, 10),
            ...preparedResponse.data,
            recipientPhone: normalizedEmployeePhone,
            selectionKey,
          };
        })();

    inFlightPreparationRef.current = { selectionKey, promise };
    void promise
      .then((prepared) => {
        if (!cancelled) {
          setPreparedServiceRecordLink(prepared);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreparationErrorKey(selectionKey);
        }
      })
      .finally(() => {
        if (inFlightPreparationRef.current?.promise === promise) {
          inFlightPreparationRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    clientId,
    employeeId,
    normalizedEmployeePhone,
    preparedServiceRecordLink?.selectionKey,
    selectionKey,
  ]);

  useEffect(() => {
    if (mode !== "receipt-link") return;
    if (receiptSelectionKey === null || clientId === null) {
      return;
    }
    if (preparedReceiptLink?.selectionKey === receiptSelectionKey) {
      return;
    }

    let cancelled = false;
    const existingRequest = inFlightReceiptPreparationRef.current;
    const promise = existingRequest?.selectionKey === receiptSelectionKey
      ? existingRequest.promise
      : (async (): Promise<PreparedReceiptLink> => {
          const prepared = await eformsignApi.prepareReceiptLink(clientId);
          const preparedClientName = typeof prepared.clientName === "string"
            ? prepared.clientName.trim()
            : "";
          const preparedPhone = normalizeKoreanPhoneLookupKey(prepared.recipientPhone);
          if (
            prepared.clientId !== clientId
            || !preparedClientName
            || !isValidKoreanPhoneNumber(preparedPhone)
            || !prepared.documentId
            || !prepared.receiptUrl
          ) {
            throw new Error("Receipt preparation identity mismatch");
          }

          return {
            ...prepared,
            clientName: preparedClientName,
            recipientPhone: preparedPhone,
            selectionKey: receiptSelectionKey,
          };
        })();

    inFlightReceiptPreparationRef.current = { selectionKey: receiptSelectionKey, promise };
    void promise
      .then((prepared) => {
        if (cancelled) return;
        setPreparedReceiptLink(prepared);
        // The prepare response is authoritative. Keep the send form's visible
        // identity aligned with the exact payload that will be sent.
        setClientName(prepared.clientName);
        setClientPhone(prepared.recipientPhone);
        setReceiptPreparationError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setReceiptPreparationError({
            key: receiptSelectionKey,
            message: describeReceiptLinkError(error),
          });
        }
      })
      .finally(() => {
        if (inFlightReceiptPreparationRef.current?.promise === promise) {
          inFlightReceiptPreparationRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    clientId,
    mode,
    preparedReceiptLink?.selectionKey,
    receiptPreparationAttempt,
    receiptSelectionKey,
    setClientName,
    setClientPhone,
  ]);

  const resolvedEmployeeName = employeeName.trim() || "{{employeeName}}";
  const resolvedClientName = clientName.trim() || "{{clientName}}";
  const resolvedServiceStartDate = currentPreparation?.serviceStartDate ?? "{{serviceStartDate}}";
  const resolvedServiceRecordUrl = currentPreparation?.serviceRecordUrl ?? "{{serviceRecordUrl}}";
  const serviceRecordLinkDisplayValue = currentPreparation?.serviceRecordUrl
    ?? (selectionKey === null
      ? "필수 정보 입력 후 생성"
      : preparationErrorKey === selectionKey
        ? "배정 정보를 확인해 주세요."
        : "링크 준비 중…");
  const resolvedReceiptClientName = currentReceiptPreparation?.clientName
    ?? (clientName.trim() || "{{name}}");
  const resolvedReceiptPhone = currentReceiptPreparation?.recipientPhone
    ?? (normalizedClientPhone || "{{phone}}");
  const resolvedReceiptUrl = currentReceiptPreparation?.receiptUrl ?? "{{receiptUrl}}";
  const receiptLinkDisplayValue = currentReceiptPreparation?.receiptUrl
    ?? (receiptSelectionKey === null
      ? "산모 선택 후 생성"
      : receiptPreparationError?.key === receiptSelectionKey
        ? receiptPreparationError.message
        : "링크 준비 중…");
  const receiptClientDisplayName = currentReceiptPreparation?.clientName ?? (clientName.trim() || "-");
  const receiptPhoneDisplayValue = currentReceiptPreparation?.recipientPhone ?? (clientPhone.trim() || "-");
  const serviceRecordTemplateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {
        employeeName: resolvedEmployeeName,
        clientName: resolvedClientName,
        serviceStartDate: resolvedServiceStartDate,
        serviceRecordUrl: resolvedServiceRecordUrl,
      })
    : "";
  const receiptTemplateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {
        name: resolvedReceiptClientName,
        clientName: resolvedReceiptClientName,
        phone: resolvedReceiptPhone,
        receiptUrl: resolvedReceiptUrl,
      })
    : "";
  const generatedMessage = mode === "receipt-link" ? receiptTemplateMessage : serviceRecordTemplateMessage;

  useEffect(() => {
    onPreviewMessageChange?.(generatedMessage);
  }, [generatedMessage, onPreviewMessageChange]);

  const handleCopy = () => {
    return navigator.clipboard.writeText(generatedMessage);
  };

  const invalidatePreparedServiceRecordLink = () => {
    setPreparedServiceRecordLink(null);
    setPreparationErrorKey(null);
  };

  const handleEmployeeChange = (
    nextEmployeeId: number | null,
    employee: Employee | null,
  ) => {
    invalidatePreparedServiceRecordLink();
    if (!employee || nextEmployeeId === null) {
      resetEmployeeFields();
      return;
    }

    setEmployeeSelection(nextEmployeeId, employee.name, employee.phone);
    setIsEmployeeManualEntry(false);
  };

  const handleEmployeeManualNameChange = (value: string) => {
    invalidatePreparedServiceRecordLink();
    const nextName = value.trimStart();
    if (!nextName.trim()) {
      resetEmployeeFields();
      return;
    }

    setEmployeeSelection(null, nextName, employeePhone);
    setIsEmployeeManualEntry(true);
  };

  const handleClientChange = (
    nextClientId: number | null,
    client: Client | null,
  ) => {
    invalidatePreparedServiceRecordLink();
    setPreparedReceiptLink(null);
    setReceiptPreparationError(null);
    if (!client || nextClientId === null) {
      setClientId(null);
      if (mode === "receipt-link") {
        setClientName("");
        setClientPhone("");
      }
      return;
    }

    setClientId(nextClientId);
    setClientName(client.name);
    if (mode === "receipt-link") {
      setClientPhone(client.phone ?? "");
    }
  };

  const handleClientManualNameChange = (value: string) => {
    invalidatePreparedServiceRecordLink();
    setPreparedReceiptLink(null);
    setReceiptPreparationError(null);
    setClientId(null);
    setClientName(value);
  };

  const handleEmployeePhoneChange = (value: string) => {
    invalidatePreparedServiceRecordLink();
    setEmployeePhone(value);
  };

  const fields = mode === "receipt-link" ? (
    <>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-end-notice-client-name-field">
        <ClientAutocomplete
          data-component="desktop_messages_sections_service-end-notice-client-name-field_autocomplete"
          containerClassName={ALIGNED_AUTOCOMPLETE_CLASS_NAME}
          value={clientId}
          onChange={handleClientChange}
          label="산모님 성함"
          placeholder="기존 고객을 선택해 주세요"
          allowManualEntry={false}
          required
        />
      </TemplateFieldGridItem>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-end-notice-client-phone-field">
        <ContactInput
          phone={clientPhone}
          setPhone={setClientPhone}
          label="산모님 전화번호"
          placeholder="010-0000-0000"
          required
          disabled
          dataComponent="desktop_messages_sections_service-end-notice-client-phone-input"
        />
      </TemplateFieldGridItem>
      {receiptSelectionKey !== null && receiptPreparationError?.key === receiptSelectionKey ? (
        <div
          data-component="desktop_messages_sections_service-end-notice-preparation-error"
          className="space-y-2"
        >
          <p role="alert" data-slot="message" className="text-sm text-destructive">
            {receiptPreparationError.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setReceiptPreparationError(null);
              setReceiptPreparationAttempt((attempt) => attempt + 1);
            }}
          >
            링크 다시 준비
          </Button>
        </div>
      ) : null}
    </>
  ) : (
    <>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-feedback-link-employee-name-field">
        <EmployeeAutocomplete
          data-component="desktop_messages_sections_service-feedback-link-employee-name-field_autocomplete"
          containerClassName={ALIGNED_AUTOCOMPLETE_CLASS_NAME}
          value={employeeId}
          onChange={handleEmployeeChange}
          label="관리사님 성함"
          placeholder="새로 입력 또는 기존 직원 선택"
          allowManualInput
          manualValue={employeeName}
          onManualInputChange={handleEmployeeManualNameChange}
          required
        />
      </TemplateFieldGridItem>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-feedback-link-employee-phone-field">
        <ContactInput
          phone={employeePhone}
          setPhone={handleEmployeePhoneChange}
          label="관리사님 전화번호"
          placeholder="010-0000-0000"
          required
          dataComponent="desktop_messages_sections_service-feedback-link-employee-phone-input"
        />
      </TemplateFieldGridItem>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-feedback-link-client-name-field">
        <ClientAutocomplete
          data-component="desktop_messages_sections_service-feedback-link-client-name-field_autocomplete"
          containerClassName={ALIGNED_AUTOCOMPLETE_CLASS_NAME}
          value={clientId}
          onChange={handleClientChange}
          label="산모님 성함"
          placeholder="새로 입력 또는 기존 고객 선택"
          manualValue={clientName}
          onManualValueChange={handleClientManualNameChange}
          required
        />
      </TemplateFieldGridItem>
    </>
  );

  const messageCard = mode === "receipt-link" ? (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "영수증 다운로드 안내 문구를 확인할 수 있어요."}
      metaItems={[
        { label: "템플릿 유형", value: "서비스 종료 안내" },
        { label: "산모님 성함", value: receiptClientDisplayName },
        { label: "산모님 전화번호", value: receiptPhoneDisplayValue },
        { label: "영수증 링크", value: receiptLinkDisplayValue },
      ]}
      variableItems={[
        { token: "{{name}}", label: "산모님 성함", value: receiptClientDisplayName },
        { token: "{{clientName}}", label: "산모님 성함", value: receiptClientDisplayName },
        { token: "{{phone}}", label: "산모님 전화번호", value: receiptPhoneDisplayValue },
        { token: "{{receiptUrl}}", label: "영수증 링크", value: receiptLinkDisplayValue },
      ]}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  ) : (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      copySuccessMessage={t(locale, "common.copy-success-message")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "제공기록지 작성 링크 문구를 수정할 수 있어요."}
      metaItems={[
        { label: "템플릿 유형", value: "제공기록지 작성 링크" },
        { label: "관리사님 성함", value: employeeName.trim() || "-" },
        { label: "관리사님 전화번호", value: employeePhone.trim() || "-" },
        { label: "산모님 성함", value: clientName.trim() || "-" },
        { label: "서비스 시작일", value: currentPreparation?.serviceStartDate ?? "-" },
        { label: "제공기록지 링크", value: serviceRecordLinkDisplayValue },
      ]}
      variableItems={[
        { token: "{{employeeName}}", label: "관리사님 성함", value: employeeName.trim() || "-" },
        { token: "{{clientName}}", label: "산모님 성함", value: clientName.trim() || "-" },
        {
          token: "{{serviceStartDate}}",
          label: "서비스 시작일",
          value: currentPreparation?.serviceStartDate ?? "-",
        },
        { token: "{{serviceRecordUrl}}", label: "제공기록지 링크", value: serviceRecordLinkDisplayValue },
      ]}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  );

  return (
    <TemplateMessageFormFrame
      dataComponent={mode === "receipt-link"
        ? "desktop_messages_sections_service-end-notice-form"
        : "desktop_messages_sections_service-feedback-link-form"}
      fields={fields}
      fieldsLayout="stack"
      messageCard={messageCard}
      deliveryMode={mode}
      serviceRecordLinkPreparation={mode === "service-feedback-link" ? currentPreparation : undefined}
      receiptLinkPreparation={mode === "receipt-link" ? currentReceiptPreparation : undefined}
      templateReady={templateReady}
      renderLayout={renderLayout}
    />
  );
};
