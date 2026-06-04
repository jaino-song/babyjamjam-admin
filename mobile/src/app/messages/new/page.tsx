"use client";

import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";

import { useMessagesPermissionGuard } from "@/app/messages/MessagesPermissionGuard";
import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { MsgField } from "@/components/app/messages/templates/MsgField";
import { greetingMsgTemplate } from "@/components/app/messages/templates/messageTemplate/greetingMsg";
import { serviceInfoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/serviceInfoMsg";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import type { CustomVariable, TemplateVariable } from "@/features/system-templates/types";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import type { Client } from "@/lib/client/types";
import { api } from "@/lib/api/client";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "@/lib/phone";
import { parsePositiveIntQueryParam } from "@/lib/query-params";
import { extractVariables, renderTemplate } from "@/lib/template-utils";
import { cn } from "@/lib/utils";

import styles from "./page.module.css";

interface SendResponse {
  result?: {
    resultCode?: number;
    message?: string;
    errorCount?: number;
  };
  message?: string;
}

interface RecipientChip {
  id: string;
  clientId: number | null;
  name: string;
  phone: string;
  initial: string;
  tone: "primary" | "orange";
}

interface TemplateOption {
  id: string;
  name: string;
  body: string;
  variables: TemplateInputVariable[];
}

interface TemplateInputVariable {
  key: string;
  label: string;
  required: boolean;
  type?: TemplateVariable["type"];
}

interface NewMessageFormProps {
  initialBody: string;
  initialTemplateId: string;
  initialClientId: number | null;
}

const PHONE_REGEX = /^[0-9,\-\s]+$/;
const SINGLE_PHONE_REGEX = /^[0-9-]+$/;
const MAX_BODY = 2000;
const SMS_BYTE_LIMIT = 90;
const MAX_LMS_TITLE_BYTES = 44;
const MAX_RECIPIENTS = 50;
const RECIPIENT_REQUIRED_MESSAGE = "수신자를 선택하거나 전화번호를 Enter로 추가해 주세요.";
const DUPLICATE_RECIPIENT_MESSAGE = "이미 추가된 수신자입니다.";
const INVALID_PHONE_ENTRY_MESSAGE = "기존 고객이 없으면 올바른 전화번호를 입력한 뒤 Enter를 눌러 추가해 주세요.";
const CLIENT_WITHOUT_PHONE_MESSAGE = "선택한 고객에 등록된 연락처가 없습니다.";
const DEFAULT_LMS_TITLE = "안내";
const GREETING_TEMPLATE_ID = "GREETING";
const SERVICE_INFO_TEMPLATE_ID = "service_info";
const CUSTOM_TEMPLATE_ID = "__custom__";
const CUSTOM_TEMPLATE_OPTION: TemplateOption = {
  id: CUSTOM_TEMPLATE_ID,
  name: "직접 작성",
  body: "",
  variables: [],
};

function normalizePhone(raw: string) {
  return raw.replace(/[^0-9\-,]/g, "");
}

function splitRecipientPhones(raw: string) {
  return normalizePhone(raw)
    .split(",")
    .map((phone) => phone.trim())
    .filter(Boolean);
}

function hasUnreplacedVariables(text: string) {
  return /#\{[^}]+\}/.test(text);
}

function getRecipientInitial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0) : "수";
}

function formatRecipientPhone(phone: string) {
  return formatKoreanPhoneNumber(phone);
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

function shouldSendAsLms(message: string) {
  return getTextByteLength(message) > SMS_BYTE_LIMIT;
}

function getLmsTitle(option: TemplateOption) {
  const candidate = option.id === CUSTOM_TEMPLATE_ID ? DEFAULT_LMS_TITLE : option.name.trim();

  return getTextByteLength(candidate) <= MAX_LMS_TITLE_BYTES
    ? candidate
    : DEFAULT_LMS_TITLE;
}

function getDefaultVariableLabel(key: string) {
  if (key === "name") return "산모명";
  return key;
}

function normalizeTemplateVariables(
  requiredVariables: TemplateVariable[] = [],
  customVariables: CustomVariable[] = [],
  content = "",
): TemplateInputVariable[] {
  const variables = new Map<string, TemplateInputVariable>();

  requiredVariables.forEach((variable) => {
    variables.set(variable.key, {
      key: variable.key,
      label: variable.label || getDefaultVariableLabel(variable.key),
      required: variable.required,
      type: variable.type,
    });
  });

  customVariables.forEach((variable) => {
    variables.set(variable.key, {
      key: variable.key,
      label: variable.label || getDefaultVariableLabel(variable.key),
      required: variable.required,
    });
  });

  extractVariables(content).forEach((key) => {
    if (!variables.has(key)) {
      variables.set(key, {
        key,
        label: getDefaultVariableLabel(key),
        required: true,
      });
    }
  });

  return Array.from(variables.values());
}

function getServiceInfoFallbackVariables(content?: string): TemplateInputVariable[] {
  const variables = normalizeTemplateVariables([], [], content ?? "");

  if (variables.length > 0) {
    return variables;
  }

  return [{ key: "name", label: "산모명", required: true, type: "string" }];
}

function getVariableInputId(key: string) {
  return `template-variable-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function getVariablePlaceholder(variable: TemplateInputVariable) {
  if (variable.key === "name") return "홍길동";
  if (variable.type === "currency") return "예: 100,000";
  if (variable.type === "number") return "숫자 입력";
  return `${variable.label} 입력`;
}

function getVariableInputMode(variable: TemplateInputVariable): React.HTMLAttributes<HTMLInputElement>["inputMode"] {
  return variable.type === "number" || variable.type === "currency" ? "numeric" : "text";
}

function buildTemplateValues(
  variables: TemplateInputVariable[],
  values: Record<string, string>,
): Record<string, string> {
  return variables.reduce<Record<string, string>>((acc, variable) => {
    acc[variable.key] = values[variable.key] ?? "";
    return acc;
  }, {});
}

function renderTemplateWithValues(
  content: string,
  variables: TemplateInputVariable[],
  values: Record<string, string>,
  templateId: string,
) {
  const templateValues = buildTemplateValues(variables, values);
  const rendered = renderTemplate(content, templateValues);
  const name = templateValues.name?.trim();

  if (
    templateId === SERVICE_INFO_TEMPLATE_ID &&
    name &&
    !/\{\{\s*name\s*\}\}/.test(content)
  ) {
    return rendered.replace(/(^|\n)(\s*)산모님/u, `$1$2${name} 산모님`);
  }

  return rendered;
}

export default function NewMessagePage() {
  const searchParams = useSearchParams();
  const initialBody = searchParams.get("body") ?? "";
  const initialTemplateId = searchParams.get("template") ?? GREETING_TEMPLATE_ID;
  const initialClientId = parsePositiveIntQueryParam(searchParams.get("clientId"));
  const routeSeedKey = `${initialBody}\u0000${initialTemplateId}`;

  return (
    <NewMessageForm
      key={routeSeedKey}
      initialBody={initialBody}
      initialTemplateId={initialTemplateId}
      initialClientId={initialClientId}
    />
  );
}

function NewMessageForm({ initialBody, initialTemplateId, initialClientId }: NewMessageFormProps) {
  const router = useRouter();
  const [receiver, setReceiver] = useState("");
  const [recipients, setRecipients] = useState<RecipientChip[]>([]);
  const [bodyOverride, setBodyOverride] = useState<string | null>(initialBody.trim() ? initialBody : null);
  const [templateVariableValues, setTemplateVariableValues] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(initialTemplateId);
  const {
    isLoading: isSenderApprovalLoading,
    needsSenderApproval,
  } = useMessagesPermissionGuard();

  const { data: greetingSystemTemplate } = useSystemTemplate(GREETING_TEMPLATE_ID);
  const { data: serviceInfoSystemTemplate } = useSystemTemplate(SERVICE_INFO_TEMPLATE_ID);
  const { data: userTemplates = [] } = useMessageTemplates();

  const templateOptions = useMemo<TemplateOption[]>(() => {
    const greetingVariables = normalizeTemplateVariables(
      greetingSystemTemplate?.requiredVariables,
      greetingSystemTemplate?.customVariables,
      greetingSystemTemplate?.content,
    );
    const greetingOption: TemplateOption = {
      id: GREETING_TEMPLATE_ID,
      name: greetingSystemTemplate?.name ?? "인사 메시지",
      body: greetingSystemTemplate?.content
        ? renderTemplateWithValues(greetingSystemTemplate.content, greetingVariables, templateVariableValues, GREETING_TEMPLATE_ID)
        : greetingMsgTemplate(),
      variables: greetingVariables,
    };
    const serviceInfoVariables = serviceInfoSystemTemplate
      ? normalizeTemplateVariables(
        serviceInfoSystemTemplate.requiredVariables,
        serviceInfoSystemTemplate.customVariables,
        serviceInfoSystemTemplate.content,
      )
      : getServiceInfoFallbackVariables();
    const serviceInfoOption: TemplateOption = {
      id: SERVICE_INFO_TEMPLATE_ID,
      name: serviceInfoSystemTemplate?.name ?? "서비스 안내",
      body: serviceInfoSystemTemplate?.content
        ? renderTemplateWithValues(
          serviceInfoSystemTemplate.content,
          serviceInfoVariables,
          templateVariableValues,
          SERVICE_INFO_TEMPLATE_ID,
        )
        : serviceInfoMsgTemplate({ name: templateVariableValues.name?.trim() ?? "" }),
      variables: serviceInfoVariables,
    };
    const userOptions = userTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      body: renderTemplateWithValues(
        template.content,
        normalizeTemplateVariables([], [], template.content),
        templateVariableValues,
        template.id,
      ),
      variables: normalizeTemplateVariables([], [], template.content),
    }));

    return [greetingOption, serviceInfoOption, ...userOptions, CUSTOM_TEMPLATE_OPTION];
  }, [greetingSystemTemplate, serviceInfoSystemTemplate, templateVariableValues, userTemplates]);
  const selectedTemplate = useMemo(
    () => templateOptions.find((template) => template.id === selectedTemplateId) ?? CUSTOM_TEMPLATE_OPTION,
    [selectedTemplateId, templateOptions],
  );
  const selectedTemplateVariables = selectedTemplate.variables;
  const body = bodyOverride ?? selectedTemplate.body;
  const payloadClientId = useMemo(() => {
    if (initialClientId !== null) {
      return initialClientId;
    }

    if (recipients.length === 1) {
      return recipients[0]?.clientId ?? null;
    }

    return null;
  }, [initialClientId, recipients]);
  const payloadRecipientName = useMemo(() => {
    if (recipients.length === 1) {
      return recipients[0]?.name ?? "";
    }

    return "";
  }, [recipients]);

  const receiverPayload = useMemo(() => {
    return recipients.map((recipient) => recipient.phone).join(",");
  }, [recipients]);
  const recipientCount = recipients.length;

  const showVariableHint = useMemo(() => hasUnreplacedVariables(body), [body]);
  const previewBody = useMemo(() => body.trim(), [body]);

  const validationError = useMemo(() => {
    if (!receiverPayload) return RECIPIENT_REQUIRED_MESSAGE;
    if (!PHONE_REGEX.test(receiverPayload)) return "수신자 연락처 형식이 올바르지 않습니다. (숫자, '-', ',' 만 허용)";
    if (splitRecipientPhones(receiverPayload).some((phone) => !SINGLE_PHONE_REGEX.test(phone))) {
      return "수신자 연락처 형식이 올바르지 않습니다. (숫자, '-', ',' 만 허용)";
    }
    if (recipientCount > MAX_RECIPIENTS) return `수신자는 한 번에 최대 ${MAX_RECIPIENTS}명까지 선택할 수 있습니다.`;
    const missingVariable = selectedTemplateVariables.find(
      (variable) => variable.required && !templateVariableValues[variable.key]?.trim(),
    );
    if (missingVariable) return `${missingVariable.label} 입력이 필요합니다.`;
    if (!body.trim()) return "메시지 본문을 입력해 주세요.";
    if (body.length > MAX_BODY) return `본문은 최대 ${MAX_BODY}자까지 입력할 수 있습니다.`;
    return null;
  }, [receiverPayload, recipientCount, selectedTemplateVariables, templateVariableValues, body]);

  const sendMutation = useMutation<SendResponse, unknown, void>({
    mutationFn: async () => {
      const message = body.trim();
      const payload: Record<string, unknown> = {
        receiver: receiverPayload,
        message,
        triggerType: "immediate",
        channel: "sms",
        msgType: "AUTO",
      };
      if (payloadClientId !== null) payload.clientId = payloadClientId;
      if (shouldSendAsLms(message)) payload.title = getLmsTitle(selectedTemplate);
      if (payloadRecipientName.trim()) payload.recipientName = payloadRecipientName.trim();
      const res = await api.post<SendResponse>("/message-deliveries/sms", payload);
      const data = res.data;
      if (
        data.result &&
        (data.result.resultCode !== 1 || (data.result.errorCount ?? 0) > 0)
      ) {
        throw new Error(data.result.message ?? "발송에 실패했습니다.");
      }
      return data;
    },
    onSuccess: () => {
      setErrorMessage(null);
      setSuccessMessage("메시지 발송 요청이 접수되었습니다.");
      setReceiver("");
      setRecipients([]);
      setTemplateVariableValues({});
      setBodyOverride("");
    },
    onError: (err) => {
      setSuccessMessage(null);
      if (isAxiosError<{ error?: string; message?: string | string[] }>(err)) {
        const data = err.response?.data;
        const msg = Array.isArray(data?.message) ? data?.message.join(", ") : data?.message;
        setErrorMessage(msg ?? data?.error ?? "발송에 실패했습니다.");
        return;
      }
      if (err instanceof Error && err.message) {
        setErrorMessage(err.message);
        return;
      }
      setErrorMessage("발송에 실패했습니다.");
    },
  });

  const addRecipientChips = (nextRecipients: RecipientChip[]) => {
    const existingPhoneSet = new Set(recipients.map((recipient) => normalizeKoreanPhoneDigits(recipient.phone)));
    const filteredRecipients = nextRecipients.filter((recipient) => {
      const normalizedPhone = normalizeKoreanPhoneDigits(recipient.phone);
      if (!normalizedPhone || existingPhoneSet.has(normalizedPhone)) {
        return false;
      }

      existingPhoneSet.add(normalizedPhone);
      return true;
    });

    if (filteredRecipients.length === 0) {
      setErrorMessage(DUPLICATE_RECIPIENT_MESSAGE);
      return;
    }

    setRecipients((current) => [...current, ...filteredRecipients]);
    setReceiver("");
    setErrorMessage(null);
  };

  const handleClientRecipientSelect = (_clientId: number | null, client: Client | null) => {
    if (!client) {
      return;
    }

    const normalizedPhone = normalizeKoreanPhoneDigits(client.phone);
    if (!normalizedPhone) {
      setErrorMessage(CLIENT_WITHOUT_PHONE_MESSAGE);
      return;
    }

    if (recipients.length >= MAX_RECIPIENTS) {
      setErrorMessage(`수신자는 한 번에 최대 ${MAX_RECIPIENTS}명까지 선택할 수 있습니다.`);
      return;
    }

    addRecipientChips([
      {
        id: `client-${client.id}`,
        clientId: client.id,
        name: client.name,
        phone: formatRecipientPhone(normalizedPhone),
        initial: getRecipientInitial(client.name),
        tone: "primary",
      },
    ]);
  };

  const addManualRecipient = (rawQuery: string) => {
    const normalizedPhones = splitRecipientPhones(rawQuery);

    if (normalizedPhones.length === 0 || normalizedPhones.some((phone) => !SINGLE_PHONE_REGEX.test(phone))) {
      setErrorMessage(INVALID_PHONE_ENTRY_MESSAGE);
      return;
    }

    if (recipients.length + normalizedPhones.length > MAX_RECIPIENTS) {
      setErrorMessage(`수신자는 한 번에 최대 ${MAX_RECIPIENTS}명까지 선택할 수 있습니다.`);
      return;
    }

    addRecipientChips(
      normalizedPhones.map((phone) => ({
        id: `manual-${normalizeKoreanPhoneDigits(phone)}`,
        clientId: null,
        name: formatRecipientPhone(phone),
        phone: formatRecipientPhone(phone),
        initial: "수",
        tone: "orange",
      })),
    );
  };

  const handleTemplateSelect = (option: TemplateOption) => {
    setSelectedTemplateId(option.id);
    setBodyOverride(null);
  };

  const handleTemplateVariableChange = (key: string, value: string) => {
    setTemplateVariableValues((current) => ({
      ...current,
      [key]: value,
    }));
    setBodyOverride(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (needsSenderApproval || isSenderApprovalLoading) {
      setErrorMessage("메시지 전송 권한이 필요합니다.");
      return;
    }

    if (validationError || sendMutation.isPending) {
      if (validationError) setErrorMessage(validationError);
      return;
    }
    sendMutation.mutate();
  };

  const primaryActionLabel =
    recipientCount > 0 ? `${recipientCount}명에게 발송` : "즉시 발송";
  const isSubmitDisabled =
    Boolean(validationError) || sendMutation.isPending || isSenderApprovalLoading || needsSenderApproval;

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.replace("/messages");
  };

  return (
    <section data-component="messages-new-page" className={styles.pageRoot}>
      <div data-component="messages-new-screen" className={styles.phoneScreen}>
        <form data-component="messages-new-form" onSubmit={handleSubmit} className={styles.navPage}>
          <header data-component="messages-new-header" className={styles.detailHeader}>
            <button
              type="button"
              onClick={handleBack}
              aria-label="메시지 목록으로 돌아가기"
              className={styles.detailBack}
            >
              <ChevronLeft aria-hidden="true" size={22} strokeWidth={2.5} />
              <span>메시지</span>
            </button>
            <div data-component="messages-new-title" className={styles.detailTitle}>새 메시지</div>
          </header>

          <div data-component="messages-new-scroll" className={styles.msgScroll}>
            <Card data-component="messages-new-recipient-card" className={cn(styles.formCard, styles.recipientCard)}>
              <CardContent className={styles.formCardContent}>
                <div data-component="messages-new-recipient-row" className={styles.formSection}>
                  <label htmlFor="receiver" className={styles.formLabel}>
                    수신자 <span className={styles.required}>*</span>
                  </label>
                  <ClientAutocomplete
                    inputId="receiver"
                    value={null}
                    onChange={handleClientRecipientSelect}
                    inputValue={receiver}
                    onInputValueChange={setReceiver}
                    placeholder="이름 또는 전화번호"
                    label=""
                    allowManualEntry
                    manualEntryLabel="입력한 번호 추가"
                    manualEntryDescription="검색 결과가 없으면 전화번호를 입력한 뒤 Enter로 수신자에 추가합니다"
                    onManualEntry={addManualRecipient}
                  />
                  <div data-component="messages-new-recipient-chips" className={styles.recipientChips}>
                    {recipients.map((recipient) => (
                      <span key={recipient.id} className={styles.recipientChip}>
                        <span className={cn(styles.recipientChipAvatar, styles[`recipient_${recipient.tone}`])}>
                          {recipient.initial}
                        </span>
                        {recipient.name}
                        <button
                          type="button"
                          aria-label={`${recipient.name} 수신자 제거`}
                          className={styles.recipientChipX}
                          onClick={() => setRecipients((current) => current.filter((item) => item.id !== recipient.id))}
                        >
                          <X aria-hidden="true" size={10} strokeWidth={3} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-component="messages-new-template-card" className={styles.formCard}>
              <CardContent className={styles.formCardContent}>
                <div data-component="messages-new-template-row" className={styles.formSection}>
                  <label id="template-select-label" htmlFor="template-select" className={styles.formLabel}>
                    템플릿 선택 <span className={styles.required}>*</span>
                  </label>
                  <Select
                    value={selectedTemplate.id}
                    onValueChange={(value) => {
                      const option = templateOptions.find((template) => template.id === value);
                      if (option) handleTemplateSelect(option);
                    }}
                  >
                    <SelectTrigger
                      id="template-select"
                      data-component="messages-new-template-select"
                      aria-labelledby="template-select-label"
                      className={styles.templateSelectTrigger}
                    >
                      <SelectValue placeholder="템플릿 선택" />
                    </SelectTrigger>
                    <SelectContent
                      className={styles.templateSelectContent}
                      avoidCollisions
                    >
                      {templateOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {selectedTemplateVariables.length > 0 ? (
              <Card data-component="messages-new-template-variables-card" className={styles.formCard}>
                <CardContent className={styles.formCardContent}>
                  {selectedTemplateVariables.map((variable) => {
                    const inputId = getVariableInputId(variable.key);
                    return (
                      <div
                        key={variable.key}
                        data-component="messages-new-template-variable-row"
                        data-template-variable-key={variable.key}
                        className={styles.formSection}
                      >
                        <label htmlFor={inputId} className={styles.formLabel}>
                          {variable.label}
                          {variable.required ? <span className={styles.required}>*</span> : null}
                        </label>
                        <input
                          id={inputId}
                          data-component="messages-new-template-variable-input"
                          data-template-variable-key={variable.key}
                          className={styles.variableInput}
                          inputMode={getVariableInputMode(variable)}
                          value={templateVariableValues[variable.key] ?? ""}
                          placeholder={getVariablePlaceholder(variable)}
                          onChange={(event) => handleTemplateVariableChange(variable.key, event.target.value)}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}

            <Card data-component="messages-new-body-card" className={styles.formCard}>
              <CardContent className={styles.formCardContent}>
                <div data-component="messages-new-body-row" className={styles.formSection}>
                  <div data-component="messages-new-body-header" className={styles.formSectionHeader}>
                    <label htmlFor="body" className={styles.formLabel}>
                      메시지 본문
                    </label>
                    <Button
                      type="button"
                      data-component="messages-new-preview-open"
                      variant="ghost"
                      className={styles.previewButton}
                      onClick={() => setIsPreviewOpen(true)}
                    >
                      미리보기
                    </Button>
                  </div>
                  <MsgField
                    inputId="body"
                    ariaLabel="메시지 본문"
                    value={body}
                    maxLength={MAX_BODY}
                    onChange={setBodyOverride}
                    className={styles.messageField}
                    textareaClassName={styles.messageFieldTextarea}
                  />
                  {showVariableHint ? (
                    <p data-component="messages-new-variable-hint" className={styles.screenReaderNote}>
                      템플릿 변수가 포함되어 있습니다.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {errorMessage ? (
              <Alert
                data-component="messages-new-error"
                variant="destructive"
                className={styles.feedbackAlert}
              >
                {errorMessage}
              </Alert>
            ) : null}

            {successMessage ? (
              <Alert
                data-component="messages-new-success"
                variant="success"
                className={styles.feedbackAlert}
              >
                {successMessage}
              </Alert>
            ) : null}
          </div>

          <div data-component="messages-new-actions" className={styles.msgActions}>
            <Button
              type="submit"
              data-component="messages-new-submit"
              disabled={isSubmitDisabled}
              variant="v3"
              className={styles.submitButton}
            >
              {sendMutation.isPending ? "발송 중..." : primaryActionLabel}
            </Button>
          </div>
        </form>
        <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
          <DialogContent
            data-component="messages-new-preview-dialog"
            className={styles.previewDialogContent}
          >
            <DialogHeader className={styles.previewDialogHeader}>
              <DialogTitle className={styles.previewDialogTitle}>미리보기</DialogTitle>
              <DialogDescription className={styles.screenReaderNote}>
                현재 메시지 본문을 SMS 형태로 미리 봅니다.
              </DialogDescription>
            </DialogHeader>
            <div data-component="messages-new-preview-body" className={styles.previewCard}>
              <div data-component="messages-new-preview-label" className={styles.previewCardLabel}>
                SMS 미리보기
              </div>
              {previewBody || "본문을 입력하면 여기에 표시됩니다."}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
