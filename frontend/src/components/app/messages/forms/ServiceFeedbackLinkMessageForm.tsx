"use client";

import { useEffect } from "react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import type { Employee } from "@/hooks/useEmployees";
import { t } from "@/lib/i18n/translations";
import type { Client } from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { renderTemplate } from "@/lib/template-utils";
import { useFormStore } from "@/stores/form-store";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import { ContactInput } from "./form-components/ContactInput";
import { TemplateFieldGridItem } from "./form-components/TemplateFieldGrid";
import {
  TemplateMessageFormFrame,
  type TemplateMessageFormLayout,
} from "./form-components/TemplateMessageFormLayout";

interface ServiceFeedbackLinkMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
  renderLayout?: TemplateMessageFormLayout;
  showMessageSide?: boolean;
}

const ALIGNED_AUTOCOMPLETE_CLASS_NAME =
  "grid gap-[calc(7px*var(--v3-ui-scale,1))] space-y-0";

export const ServiceFeedbackLinkMessageForm = ({
  onPreviewMessageChange,
  renderLayout,
  showMessageSide = true,
}: ServiceFeedbackLinkMessageFormProps) => {
  const locale = useLocale();
  const {
    clientId,
    name: clientName,
    employeeId,
    employeeName,
    employeePhone,
    setClientId,
    setName: setClientName,
    setEmployeeSelection,
    setIsEmployeeManualEntry,
    setEmployeePhone,
    resetEmployeeFields,
  } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("SERVICE_FEEDBACK_LINK");

  const resolvedEmployeeName = employeeName.trim() || "{{employeeName}}";
  const resolvedClientName = clientName.trim() || "{{clientName}}";
  const resolvedFeedbackUrl = "{{feedbackUrl}}";
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {
        employeeName: resolvedEmployeeName,
        clientName: resolvedClientName,
        feedbackUrl: resolvedFeedbackUrl,
      })
    : `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

${resolvedEmployeeName} 관리사님, ${resolvedClientName} 산모님의 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
${resolvedFeedbackUrl}`;
  const generatedMessage = templateMessage;

  useEffect(() => {
    onPreviewMessageChange?.(generatedMessage);
  }, [generatedMessage, onPreviewMessageChange]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  const handleEmployeeChange = (
    nextEmployeeId: number | null,
    employee: Employee | null,
  ) => {
    if (!employee || nextEmployeeId === null) {
      resetEmployeeFields();
      return;
    }

    setEmployeeSelection(nextEmployeeId, employee.name, employee.phone);
    setIsEmployeeManualEntry(false);
  };

  const handleEmployeeManualNameChange = (value: string) => {
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
    if (!client || nextClientId === null) {
      setClientId(null);
      return;
    }

    setClientId(nextClientId);
    setClientName(client.name);
  };

  const handleClientManualNameChange = (value: string) => {
    setClientId(null);
    setClientName(value);
  };

  const fields = (
    <>
      <TemplateFieldGridItem dataComponent="messages-service-feedback-link-employee-name-field">
        <EmployeeAutocomplete
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
      <TemplateFieldGridItem dataComponent="messages-service-feedback-link-employee-phone-field">
        <ContactInput
          phone={employeePhone}
          setPhone={setEmployeePhone}
          label="관리사님 전화번호"
          placeholder="010-0000-0000"
          required
          dataComponent="messages-service-feedback-link-employee-phone-input"
        />
      </TemplateFieldGridItem>
      <TemplateFieldGridItem dataComponent="messages-service-feedback-link-client-name-field">
        <ClientAutocomplete
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

  const messageCard = (
    <AutoFillMsgCard
      title={t(locale, "common.generated-message-title")}
      copyButtonText={t(locale, "common.copy-button")}
      message={generatedMessage}
      bodyDescription={systemTemplate?.description || "제공기록지 작성 링크 문구를 수정할 수 있어요."}
      metaItems={[
        { label: "템플릿 유형", value: "제공기록지 작성 링크" },
        { label: "관리사님 성함", value: employeeName.trim() || "-" },
        { label: "관리사님 전화번호", value: employeePhone.trim() || "-" },
        { label: "산모님 성함", value: clientName.trim() || "-" },
        { label: "제공기록지 링크", value: "발송 시 자동 생성" },
      ]}
      variableItems={[
        { token: "{{employeeName}}", label: "관리사님 성함", value: employeeName.trim() || "-" },
        { token: "{{clientName}}", label: "산모님 성함", value: clientName.trim() || "-" },
        { token: "{{feedbackUrl}}", label: "제공기록지 링크", value: "발송 시 자동 생성" },
      ]}
      handleCopy={handleCopy}
      showSide={showMessageSide}
    />
  );

  return (
    <TemplateMessageFormFrame
      dataComponent="messages-service-feedback-link-form"
      fields={fields}
      messageCard={messageCard}
      deliveryMode="service-feedback-link"
      renderLayout={renderLayout}
    />
  );
};
