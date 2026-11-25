"use client";

import { useEffect, useRef, useState } from "react";

import { LoadingState } from "@/components/app/ui/LoadingState";
import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { serviceRecordCaseLabel } from "@/features/service-records/utils/case-selection";
import { renderServiceRecordLinks } from "@babyjamjam/shared/message/service-record-links";
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
  type ReceiptLinkPreparation,
} from "./form-components/TemplateMessageFormLayout";
import { useServiceRecordPreparation } from "./form-components/useServiceRecordPreparation";

interface ServiceRecordLinkMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
  mode?: "service-feedback-link" | "receipt-link";
}

const ALIGNED_AUTOCOMPLETE_CLASS_NAME =
  "grid gap-[calc(7px*var(--glint-ui-scale,1))] space-y-0";

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
  const [registeredEmployee, setRegisteredEmployee] = useState<{ id: number; phone: string } | null>(null);
  const [preparedReceiptLink, setPreparedReceiptLink] = useState<PreparedReceiptLink | null>(null);
  const [receiptPreparationAttempt, setReceiptPreparationAttempt] = useState(0);
  const [receiptPreparationError, setReceiptPreparationError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const inFlightReceiptPreparationRef = useRef<{
    selectionKey: string;
    promise: Promise<PreparedReceiptLink>;
  } | null>(null);

  const record = useServiceRecordPreparation({
    clientId: mode === "service-feedback-link" ? clientId : null,
    employeeId,
    employeePhone,
    registeredPhone: registeredEmployee?.id === employeeId ? registeredEmployee.phone : "",
    template: templateReady ? systemTemplate?.content ?? null : null,
  });
  const currentPreparation = record.preparation;

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
  const resolvedServiceStartDate = currentPreparation?.serviceStartDate || "{{serviceStartDate}}";
  const legacyPreparation = currentPreparation?.kind !== "group" ? currentPreparation : null;
  const groupPreparation = currentPreparation?.kind === "group" ? currentPreparation : null;
  const serviceRecordLinkValue = groupPreparation
    ? groupPreparation.members.map(({ serviceRecordUrl }) => serviceRecordUrl).join("\n")
    : legacyPreparation?.serviceRecordUrl;
  const serviceRecordLinkDisplayValue = serviceRecordLinkValue
    ?? (record.pending
      ? <LoadingState inline size="sm" label="링크 준비 중" data-component="desktop_messages_sections_generated-msg-detail-meta_list_item_loading" />
      : record.hasError ? "배정 정보를 확인해 주세요." : "-");
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
        : <LoadingState inline size="sm" label="링크 준비 중" data-component="desktop_messages_sections_generated-msg-detail-meta_list_item_loading" />);
  const receiptClientDisplayName = currentReceiptPreparation?.clientName ?? (clientName.trim() || "-");
  const receiptPhoneDisplayValue = currentReceiptPreparation?.recipientPhone ?? (clientPhone.trim() || "-");
  const previewVariables = {
    employeeName: resolvedEmployeeName,
    clientName: resolvedClientName,
    serviceStartDate: resolvedServiceStartDate,
  };
  const localLegacyPreview = legacyPreparation && !legacyPreparation.previewContent && systemTemplate?.content
    ? renderServiceRecordLinks({
        template: systemTemplate.content,
        variables: previewVariables,
        householdBabyCount: null,
        members: [{ activeRank: null, url: legacyPreparation.serviceRecordUrl }],
      })
    : null;
  const serviceRecordTemplateMessage = currentPreparation?.previewContent
    ?? (localLegacyPreview?.ok ? localLegacyPreview.content : undefined)
    ?? (systemTemplate?.content ? renderTemplate(systemTemplate.content, previewVariables) : "");
  const approvedPreparation = localLegacyPreview && !localLegacyPreview.ok ? null : currentPreparation;
  const variableValues: Record<string, string> = {
    employeeName: employeeName.trim() || "-",
    clientName: clientName.trim() || "-",
    serviceStartDate: currentPreparation?.serviceStartDate || "-",
  };
  const fallbackVariables = [
    { key: "employeeName", label: "관리사님 성함" },
    { key: "clientName", label: "산모님 성함" },
    { key: "serviceStartDate", label: "서비스 시작일" },
    { key: "serviceRecordUrl", label: "제공기록지 링크" },
  ];
  const serviceRecordVariables = systemTemplate?.requiredVariables?.length
    ? systemTemplate.requiredVariables : fallbackVariables;
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


  const handleEmployeeChange = (
    nextEmployeeId: number | null,
    employee: Employee | null,
  ) => {
    record.clearSelection();
    if (!employee || nextEmployeeId === null) {
      setRegisteredEmployee(null);
      resetEmployeeFields();
      return;
    }

    setRegisteredEmployee({ id: nextEmployeeId, phone: employee.phone });
    setEmployeeSelection(nextEmployeeId, employee.name, employee.phone);
    setIsEmployeeManualEntry(false);
  };

  const handleEmployeeManualNameChange = (value: string) => {
    record.clearSelection();
    setRegisteredEmployee(null);
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
    record.clearSelection();
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
    record.clearSelection();
    setPreparedReceiptLink(null);
    setReceiptPreparationError(null);
    setClientId(null);
    setClientName(value);
  };

  const handleEmployeePhoneChange = (value: string) => {
    if (!record.locked) setEmployeePhone(value);
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
          placeholder="새로 입력 또는 기존 제공인력 선택"
          allowManualInput
          manualValue={employeeName}
          onManualInputChange={handleEmployeeManualNameChange}
          required
        />
      </TemplateFieldGridItem>
      <TemplateFieldGridItem dataComponent="desktop_messages_sections_service-feedback-link-employee-phone-field">
        <ContactInput
          phone={record.phone}
          setPhone={handleEmployeePhoneChange}
          disabled={record.locked}
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
      {record.eligible.length > 0 ? (
        <fieldset data-component="desktop_messages_sections_service-feedback-link-form_cases" data-slot="cases">
          <legend data-component="desktop_messages_sections_service-feedback-link-form_cases_legend" data-slot="legend">제공기록지 선택</legend>
          {record.eligible.map(({ record: item }) => (
            <label key={item.caseId} className="flex items-center gap-2" data-slot="option"
              data-component="desktop_messages_sections_service-feedback-link-form_cases_option">
              <Checkbox
                data-component="desktop_messages_sections_service-feedback-link-form_cases_option_checkbox"
                data-slot="case-select"
                checked={record.chosen.some(({ record }) => record.caseId === item.caseId)}
                onCheckedChange={(checked) => record.toggleCase(item.caseId, checked === true)}
              />
              {serviceRecordCaseLabel(item)}{item.rank !== null && item.rank <= 10 ? " 아기" : ""}
            </label>
          ))}
        </fieldset>
      ) : null}
      {record.hasError ? (
        <Button type="button" variant="outline" size="sm"
          data-component="desktop_messages_sections_service-feedback-link-form_retry-prepare" onClick={record.retry}>
          링크 다시 준비
        </Button>
      ) : null}
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
        { token: "{{receiptUrl}}", label: "영수증 링크", value: typeof receiptLinkDisplayValue === "string" ? receiptLinkDisplayValue : <LoadingState inline size="sm" label="링크 준비 중" data-component="desktop_messages_sections_generated-msg-detail-variables_body_list_item_value_loading" /> },
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
      bodyDescription="서비스 시작 전날 정오(한국 시간)에 자동 발송돼요."
      metaItems={[
        { label: "템플릿 유형", value: "제공기록지 작성 링크" },
        { label: "관리사님 성함", value: employeeName.trim() || "-" },
        { label: "관리사님 전화번호", value: record.phone.trim() || "-" },
        { label: "산모님 성함", value: clientName.trim() || "-" },
        { label: "서비스 시작일", value: currentPreparation?.serviceStartDate ?? "-" },
        { label: "제공기록지 링크", value: serviceRecordLinkDisplayValue },
      ]}
      variableItems={serviceRecordVariables.map(({ key, label }) => ({
        token: `{{${key}}}`,
        label,
        value: key === "serviceRecordUrl" && groupPreparation
          ? groupPreparation.buttonUrl ?? "-"
          : key === "serviceRecordUrl" || key === "serviceRecordLinks"
            ? serviceRecordLinkValue ?? (record.pending
              ? <LoadingState inline size="sm" label="링크 준비 중" data-component="desktop_messages_sections_generated-msg-detail-variables_body_list_item_value_loading" />
              : serviceRecordLinkDisplayValue)
            : variableValues[key] ?? "-",
      }))}
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
      serviceRecordLinkPreparation={mode === "service-feedback-link" ? approvedPreparation : undefined}
      receiptLinkPreparation={mode === "receipt-link" ? currentReceiptPreparation : undefined}
      templateReady={templateReady}
      renderLayout={renderLayout}
    />
  );
};
