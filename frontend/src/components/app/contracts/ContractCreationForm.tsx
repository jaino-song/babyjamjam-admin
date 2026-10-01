"use client";
import { formatBirthdayInput, normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { getUserErrorMessage } from "@babyjamjam/shared";

import dayjs from "dayjs";
import { isAxiosError } from "axios";
import "dayjs/locale/ko";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { normalizeApiError } from "@babyjamjam/shared";
import { calcEndDateBusinessDays } from "@babyjamjam/shared/utils/business-days";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/translations";
import { createReconnectingEventSource } from "@/lib/sse/reconnecting-event-source";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { Button } from "@/components/ui/button";
import { Input, V3_INPUT_CONTROL_CLASS_NAME } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WizardStep } from "@/components/app/v3";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { FormHelperText, FormNativeSelect } from "@/components/app/ui/form-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallback, useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEformsign } from "@/hooks/useEformsign";
import { useToast } from "@/hooks/use-toast";
import { useEnqueueEformsignDocumentCreation } from "@/hooks/useEformsignDocumentJobs";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import { readHeadlessOutcome } from "@/lib/eformsign/headless-outcome";
import {
  HeadlessProgressStepper,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
  type HeadlessProgressStep,
  type HeadlessProgressStepKey,
} from "@/components/app/eformsign/HeadlessProgressStepper";

import { formatIsoDateInput } from "@/lib/date/format-iso-input";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";
import { isRealIsoDate } from "@babyjamjam/shared/utils/field-validation-message";
import {
  CONTRACT_CUSTOMER_INFO_STEP_INDEX,
  CONTRACT_INPUT_FIELDS,
  CONTRACT_INPUT_FIELDS_BY_STEP,
  CONTRACT_INPUT_FIELD_CONFIG,
  hasContractPhoneProblem,
  resolveContractFieldMessage,
  toRealIsoDate,
  type ContractFocusTarget,
  type ContractInputField,
} from "@/components/app/contracts/contract-field-messages";
import type { FieldMessageView } from "@/lib/forms/field-message-text";

// API가 내려주는 날짜는 "2026-07-31T00:00:00.000Z" 같은 풀 ISO 타임스탬프일 수
// 있으므로, 표시·전자문서 payload에 쓰기 전에 날짜 부분만 잘라낸다.
function toIsoDateOnly(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

/**
 * Carries a locally authored, user-safe message across the submission catch
 * boundary. Upstream bodies are never wrapped, so only explicitly authored
 * copy survives the catch for rendering; everything else resolves through the
 * verified problem contract or the generic fallback.
 */
class AuthoredSubmissionError extends Error {}

function parseOptionalInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasPositivePrice(value: string): boolean {
  const parsed = Number.parseInt(parsePrice(value), 10);
  return Number.isFinite(parsed) && parsed > 0;
}

function isFutureDate(value: string): boolean {
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  if (!parsed.isValid()) return false;
  return parsed.startOf("day").isAfter(dayjs().startOf("day"));
}

const AREA_TEMPLATE_DISPLAY_LABELS: Record<string, string> = {
  Namdonggu: "남동구",
  Seogu: "서구",
};

// 계약서 선택 필드의 메시지는 모두 라벨 줄 오른쪽 한 줄 자리에 들어가므로 짧게 써요.
const AREA_TEMPLATES_LOADING_MESSAGE = "계약서 유형을 불러오는 중이에요";
const AREA_TEMPLATES_ERROR_MESSAGE = "계약서 유형을 불러오지 못했어요";
const AREA_TEMPLATES_EMPTY_MESSAGE = "설정된 계약서 유형이 없어요";
const AREA_TEMPLATE_SELECTION_INVALID_MESSAGE = "계약서 선택을 다시 확인해 주세요";
const AREA_TEMPLATE_MESSAGE_ID = "contract-creation-area-template-message";
const AREA_TEMPLATE_REQUIRED_MESSAGE = "계약서를 선택해 주세요";
const CLIENT_NAME_REQUIRED_MESSAGE = "산모님 성함을 입력해 주세요";
const EMPLOYEE_REQUIRED_MESSAGE = "제공인력을 선택해 주세요";
const VOUCHER_TYPE_REQUIRED_MESSAGE = "바우처 유형을 선택해 주세요";
const VOUCHER_DURATION_REQUIRED_MESSAGE = "기간을 선택해 주세요";
const PRICE_REQUIRED_MESSAGE = "금액을 입력해 주세요";

function getAreaTemplateDisplayLabel(areaId: string, templateName?: string | null): string {
  const mappedLabel = AREA_TEMPLATE_DISPLAY_LABELS[areaId];
  if (mappedLabel) return mappedLabel;

  return templateName?.replace(/\s*계약서.*$/, "").trim() || areaId;
}

import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { useVoucherPriceInfos, useVoucherYears, useAreaTemplates } from "@/hooks";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { ContactInput } from "@/components/app/messages/forms/form-components/ContactInput";
import { TitleTextInputMolecule } from "@/components/app/messages/forms/form-components/TitleTextInputMolecule";
import { ContractClientSelector } from "@/components/app/contracts/ContractClientSelector";
import { ContractEmployeeSelector } from "@/components/app/contracts/ContractEmployeeSelector";
import { useCreateClient, useDeleteClient, useUpdateClient } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import type { Client } from "@/lib/client/types";
import type { Employee } from "@/hooks/useEmployees";
import {
  SteppedWizardPanelContent,
} from "@/components/app/v3/SteppedWizardPanelLayout";
import {
  DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME,
  DETAIL_PANEL_FOOTER_CLASS_NAME,
  DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME,
} from "@/components/app/v3/DetailPanel";

interface ContractDataDto {
  customerName: string;
  customerContact: string;
  customerDOB: string;
  customerAddress: string;
  caretaker1Name: string;
  caretaker1Contact: string;
  type: string;
  days: string;
  area: string;
  contractDuration: string;
  startYear: string;
  startMonth: string;
  startDay: string;
  startDate: string;
  endYear: string;
  endMonth: string;
  endDay: string;
  endDate: string;
  paymentYear: string;
  paymentMonth: string;
  paymentDay: string;
  receiptYear: string;
  receiptMonth: string;
  receiptDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  issuerPhone?: string;
}

const formatPrice = (price: number | string): string => {
  if (!price && price !== 0) return "";
  const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return "";
  return num.toLocaleString("ko-KR");
};

const parsePrice = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.replace(/,/g, "");
};

const COMPLETED_PILL =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-v3-green-light border-[1.5px] border-[hsl(137,40%,85%)] text-[0.85rem] font-semibold text-v3-dark";

const INPUT_CLS = "bg-white";

const LABEL_CLS = "text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted";
const PANEL_GRID_CLASS_NAME =
  "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] md:grid-cols-2";
const PANEL_THREE_COLUMN_GRID_CLASS_NAME =
  "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] md:grid-cols-3";

const SELECT_CLS =
  cn(
    V3_INPUT_CONTROL_CLASS_NAME,
    "w-full focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
  );

export interface ContractCreationFormLayoutParts {
  content: ReactNode;
  footer: ReactNode;
  footerClassName?: string;
}

export interface ContractCreationFormProps {
  onClose?: () => void;
  onSuccess?: () => void;
  onSessionStateChange?: (hasSession: boolean) => void;
  onProcessingFailureChange?: (failed: boolean) => void;
  onSubmissionStateChange?: (submitting: boolean) => void;
  activeStep?: number;
  onActiveStepChange?: (step: number) => void;
  contentClassName?: string;
  stepContentClassName?: string;
  footerClassName?: string;
  renderLayout?: (parts: ContractCreationFormLayoutParts) => ReactNode;
  initialClient?: Client;
}

const CONTRACT_CREATION_PROGRESS_STEPS: readonly HeadlessProgressStep[] = [
  { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
  { key: "info-inserted", label: "이용자 정보 입력 완료", errorLabel: "이용자 정보 입력 실패" },
  { key: "creating", label: "전자문서 생성 중", errorLabel: "전자문서 생성 실패" },
  { key: "sent", label: "전자문서 전송 완료", errorLabel: "전자문서 전송 실패" },
];

export const CONTRACT_CREATION_STEPPER_STEPS = [
  { label: "이용자\n정보" },
  { label: "제공인력\n정보" },
  { label: "바우처\n정보" },
  { label: "계약\n정보" },
  { label: "전자문서 생성" },
] as const;

const CONTRACT_INFO_STEP_INDEX = 3;
const CONTRACT_CREATION_PROCESSING_STEP_INDEX = 4;
const CONTRACT_CREATION_MANUAL_HELP = "수동으로 입력해 주세요";

interface ContractCreationRunOptions {
  mode?: "auto" | "manual";
}

const INITIAL_CREATION_PROGRESS: HeadlessProgressState = {
  step: null,
  completed: false,
  failed: false,
};

function isHeadlessProgressStepKey(value: string): value is HeadlessProgressStepKey {
  return CONTRACT_CREATION_PROGRESS_STEPS.some((item) => item.key === value);
}

function createHeadlessProgressId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `contract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getSafeHeadlessFailureMessage(reason: string | undefined): string {
  const knownProviderFailureMessage = getKnownHeadlessProviderFailureMessage(reason);
  if (knownProviderFailureMessage) return knownProviderFailureMessage;
  if (!reason) {
    return "백엔드 자동 처리에 실패했어요. 재시도하거나 수동 입력을 사용해 주세요.";
  }
  if (reason === "CLIENT_ASSIGNMENT_REQUIRED") {
    return "고객의 제공인력 배정을 먼저 저장한 뒤 다시 시도해 주세요.";
  }
  if (reason === "DOCUMENT_PROVIDER_MISMATCH") {
    return "전자문서의 제공인력과 고객 배정 정보가 일치하지 않아요. 배정을 확인해 주세요.";
  }
  if (reason === "CLIENT_SERVICE_TERMINATED") {
    return "해지된 고객에게는 전자문서를 발송할 수 없어요.";
  }
  if (/timed out|timeout/i.test(reason)) {
    return "백엔드 자동 처리 시간이 초과되었습니다. 재시도하거나 수동 입력을 사용해 주세요.";
  }
  if (/chromium|browser|executable/i.test(reason)) {
    return "백엔드 브라우저 실행에 실패했어요. 수동 입력으로 진행해 주세요.";
  }
  if (/missing document_id/i.test(reason)) {
    return "전자문서 전송 응답에서 문서 ID를 받지 못했습니다. 재시도하거나 수동 입력을 사용해 주세요.";
  }
  return "백엔드 자동 처리에 실패했어요. 재시도하거나 수동 입력을 사용해 주세요.";
}

function getKnownHeadlessProviderFailureMessage(reason: string | undefined): string | null {
  switch (reason) {
    case "template_workflow_config_invalid":
      return "이번 요청에서 계약서를 발송하지 않았어요. 계약서 템플릿 설정이 올바르지 않아요. 관리자에게 템플릿 설정을 확인하고 수정해 달라고 요청한 뒤 다시 시도해 주세요. 입력한 고객 정보와 날짜는 그대로 남아 있어요.";
    case "template_workflow_unsupported":
      return "이번 요청에서 계약서를 발송하지 않았어요. 현재 계약서 템플릿에서 지원하지 않는 항목이 있어요. 관리자에게 템플릿 설정을 확인하고 항목을 수정해 달라고 요청한 뒤 다시 시도해 주세요. 입력한 고객 정보와 날짜는 그대로 남아 있어요.";
    case "template_workflow_config_unavailable":
      return "이번 요청에서 계약서를 발송하지 않았어요. 계약서 템플릿 설정을 잠시 불러오지 못했어요. 잠시 후 다시 시도해 주세요. 입력한 고객 정보와 날짜는 그대로 남아 있어요.";
    default:
      return null;
  }
}

function serializeClientPersistencePayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

// 저장된 고객과 계약서 입력값을 비교하기 위한 정규화 값. value는 비교용, display는 안내창 표시용이에요.
type ClientDiffKey =
  | "name"
  | "phone"
  | "birthday"
  | "address"
  | "dueDate"
  | "birthDate"
  | "areaId"
  | "primaryEmployeeId"
  | "secondaryEmployeeId"
  | "type"
  | "duration"
  | "fullPrice"
  | "grant"
  | "actualPrice"
  | "startDate"
  | "endDate";

interface ClientDiffValue {
  value: string | null;
  display: string | null;
}

type ClientDiffSnapshot = Record<ClientDiffKey, ClientDiffValue>;

interface ClientDiffRow {
  key: ClientDiffKey;
  label: string;
  oldDisplay: string;
  newDisplay: string;
}

type ClientDiffDecision = "contract-only" | "update-client" | "cancel";

interface ClientDiffPrompt {
  rows: ClientDiffRow[];
  showPeriodLockedNote: boolean;
}

interface LoadedClientBaseline {
  id: number;
  snapshot: ClientDiffSnapshot;
  periodLocked: boolean;
}

const CLIENT_DIFF_KEYS: readonly ClientDiffKey[] = [
  "name",
  "phone",
  "birthday",
  "address",
  "dueDate",
  "birthDate",
  "areaId",
  "primaryEmployeeId",
  "secondaryEmployeeId",
  "type",
  "duration",
  "fullPrice",
  "grant",
  "actualPrice",
  "startDate",
  "endDate",
];

// 서비스 기록이 확정된 고객은 이 항목을 고객 정보에 저장할 수 없어요.
const CLIENT_PERIOD_DIFF_KEYS: ReadonlySet<ClientDiffKey> = new Set(["duration", "startDate", "endDate"]);

const CLIENT_DIFF_EMPTY_DISPLAY = "(없음)";
const CLIENT_DIFF_PERIOD_LOCKED_NOTE = "서비스 기록이 확정된 고객이라 계약 기간은 계약서에만 반영돼요.";

function getClientDiffLabel(locale: Parameters<typeof t>[0], key: ClientDiffKey): string {
  switch (key) {
    case "name": return "산모님 성함";
    case "phone": return t(locale, "contract-msg.phone-label");
    case "birthday": return t(locale, "contract-msg.birthday-label");
    case "address": return t(locale, "contract-msg.address-label");
    case "dueDate": return t(locale, "clients.form.due-date");
    case "birthDate": return "출산일";
    case "areaId": return "지역";
    case "primaryEmployeeId": return "제공인력 1";
    case "secondaryEmployeeId": return "제공인력 2";
    case "type": return t(locale, "price-info-msg.voucher-type-label");
    case "duration": return t(locale, "price-info-msg.duration-label");
    case "fullPrice": return t(locale, "contract-msg.full-price-label");
    case "grant": return t(locale, "contract-msg.grant-label");
    case "actualPrice": return t(locale, "contract-msg.actual-price-label");
    case "startDate": return t(locale, "contract-msg.start-date-label");
    case "endDate": return t(locale, "contract-msg.end-date-label");
  }
}

function diffText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function diffDate(value: string | null | undefined): string | null {
  return diffText(toIsoDateOnly(value ?? ""));
}

function diffBirthday(value: string | null | undefined): string | null {
  const trimmed = diffText(value);
  return trimmed ? normalizeBirthdayIsoDate(trimmed) ?? trimmed : null;
}

function diffPrice(value: string | null | undefined): string | null {
  return diffText(parsePrice(value));
}

function diffNumber(value: number | string | null | undefined): string | null {
  return value === null || value === undefined ? null : diffText(String(value));
}

function diffValue(value: string | null, display: string | null = value): ClientDiffValue {
  return { value, display };
}

function priceDisplay(value: string | null): string | null {
  return value === null ? null : `${formatPrice(value)}원`;
}

function areaDisplay(areaId: string | null, templateName?: string | null): string | null {
  return areaId === null ? null : getAreaTemplateDisplayLabel(areaId, templateName);
}

function buildClientDiffSnapshotFromClient(client: Client): ClientDiffSnapshot {
  const duration = diffNumber(client.duration);
  const fullPrice = diffPrice(client.fullPrice);
  const grant = diffPrice(client.grant);
  const actualPrice = diffPrice(client.actualPrice);
  const areaId = diffText(client.areaId);
  return {
    name: diffValue(diffText(client.name)),
    phone: diffValue(diffText(client.phone?.replace(/\D/g, "")), diffText(client.phone)),
    birthday: diffValue(diffBirthday(client.birthday)),
    address: diffValue(diffText(client.address)),
    dueDate: diffValue(diffDate(client.dueDate)),
    birthDate: diffValue(diffDate(client.birthDate)),
    areaId: diffValue(areaId, areaDisplay(areaId)),
    primaryEmployeeId: diffValue(
      diffNumber(client.primaryEmployee?.id),
      diffText(client.primaryEmployee?.name) ?? diffNumber(client.primaryEmployee?.id),
    ),
    secondaryEmployeeId: diffValue(
      diffNumber(client.secondaryEmployee?.id),
      diffText(client.secondaryEmployee?.name) ?? diffNumber(client.secondaryEmployee?.id),
    ),
    type: diffValue(diffText(client.type)),
    duration: diffValue(duration, duration === null ? null : `${duration}일`),
    fullPrice: diffValue(fullPrice, priceDisplay(fullPrice)),
    grant: diffValue(grant, priceDisplay(grant)),
    actualPrice: diffValue(actualPrice, priceDisplay(actualPrice)),
    startDate: diffValue(diffDate(client.startDate)),
    endDate: diffValue(diffDate(client.endDate)),
  };
}

interface ClientDiffFormValues {
  name: string;
  phone: string;
  birthday: string;
  address: string;
  dueDate: string;
  birthDate: string;
  areaId: string;
  areaTemplateName?: string | null;
  primaryEmployeeId: number | null;
  primaryEmployeeName: string;
  secondaryEmployeeId: number | null;
  secondaryEmployeeName: string;
  type: string;
  duration: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  startDate: string;
  endDate: string;
}

function buildClientDiffSnapshotFromForm(form: ClientDiffFormValues): ClientDiffSnapshot {
  const duration = diffNumber(parseOptionalInteger(form.duration));
  const fullPrice = diffPrice(form.fullPrice);
  const grant = diffPrice(form.grant);
  const actualPrice = diffPrice(form.actualPrice);
  const areaId = diffText(form.areaId);
  return {
    name: diffValue(diffText(form.name)),
    phone: diffValue(diffText(form.phone.replace(/\D/g, "")), diffText(form.phone)),
    birthday: diffValue(diffBirthday(form.birthday)),
    address: diffValue(diffText(form.address)),
    dueDate: diffValue(diffDate(form.dueDate)),
    birthDate: diffValue(diffDate(form.birthDate)),
    areaId: diffValue(areaId, areaDisplay(areaId, form.areaTemplateName)),
    primaryEmployeeId: diffValue(
      diffNumber(form.primaryEmployeeId),
      diffText(form.primaryEmployeeName) ?? diffNumber(form.primaryEmployeeId),
    ),
    secondaryEmployeeId: diffValue(
      diffNumber(form.secondaryEmployeeId),
      diffText(form.secondaryEmployeeName) ?? diffNumber(form.secondaryEmployeeId),
    ),
    type: diffValue(diffText(form.type)),
    duration: diffValue(duration, duration === null ? null : `${duration}일`),
    fullPrice: diffValue(fullPrice, priceDisplay(fullPrice)),
    grant: diffValue(grant, priceDisplay(grant)),
    actualPrice: diffValue(actualPrice, priceDisplay(actualPrice)),
    startDate: diffValue(diffDate(form.startDate)),
    endDate: diffValue(diffDate(form.endDate)),
  };
}

function diffClientSnapshots(
  locale: Parameters<typeof t>[0],
  stored: ClientDiffSnapshot,
  form: ClientDiffSnapshot,
): ClientDiffRow[] {
  return CLIENT_DIFF_KEYS.filter((key) => stored[key].value !== form[key].value).map((key) => ({
    key,
    label: getClientDiffLabel(locale, key),
    oldDisplay: stored[key].display ?? CLIENT_DIFF_EMPTY_DISPLAY,
    newDisplay: form[key].display ?? CLIENT_DIFF_EMPTY_DISPLAY,
  }));
}

function serializeClientDiffSnapshot(snapshot: ClientDiffSnapshot): string {
  return JSON.stringify(CLIENT_DIFF_KEYS.map((key) => snapshot[key].value));
}

const REGISTERED_VALUE_DIFF_HINT = "등록된 정보와 달라요.";
const NO_REGISTERED_DIFF_KEYS: ReadonlySet<ClientDiffKey> = new Set();

function getRegisteredValueDiffHintId(key: ClientDiffKey): string {
  return `contract-creation-registered-diff-hint-${key}`;
}

// 필드 값이 선택한 고객의 등록값과 다를 때 라벨 줄 오른쪽에 보여주는 힌트예요. 등록 폼의 연락처 안내와 같은 자리·크기이고 색만 초록이에요.
function RegisteredValueDiffHint({ diffKey }: { diffKey: ClientDiffKey }) {
  return (
    <FormHelperText
      id={getRegisteredValueDiffHintId(diffKey)}
      data-component={`desktop_contracts_creation_${diffKey.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}_registered-value-diff-hint`}
      data-slot="registered-value-diff-hint"
      className="m-0 truncate text-right text-v3-green"
    >
      {REGISTERED_VALUE_DIFF_HINT}
    </FormHelperText>
  );
}

// 힌트가 있을 때만 라벨과 힌트를 한 줄에 놓아요. 힌트가 없으면 라벨 마크업은 그대로예요.
// 오른쪽 자리는 라벨 한 줄 높이로 고정이고, 넘치는 메시지는 말줄임표로 잘려요. 라벨은 줄어들거나 줄바꿈되지 않아요.
function LabelWithHint({ hint, children }: { hint: ReactNode; children: ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 [&>label]:shrink-0 [&>label]:whitespace-nowrap",
        FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
      )}
    >
      {children}
      <div className={cn("flex items-center", FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME)}>{hint}</div>
    </div>
  );
}

function getVoucherTypeLabel(type: string): string {
  for (const types of Object.values(voucherOptions.voucherOptions) as Array<Record<string, { label: string }>>) {
    if (types[type]) return types[type].label;
  }
  return type;
}

export const ContractCreationForm = ({
  onClose,
  onSuccess,
  onSessionStateChange,
  onProcessingFailureChange,
  onSubmissionStateChange,
  activeStep: controlledActiveStep,
  onActiveStepChange,
  contentClassName,
  stepContentClassName,
  footerClassName,
  renderLayout,
  initialClient,
}: ContractCreationFormProps = {}) => {
  const router = useRouter();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: authUser } = useGetAuthUser();
  const [internalActiveStep, setInternalActiveStep] = useState(0);
  const activeStep = controlledActiveStep ?? internalActiveStep;
  const setActiveStep = useCallback(
    (nextStep: number) => {
      if (controlledActiveStep === undefined) {
        setInternalActiveStep(nextStep);
      }
      onActiveStepChange?.(nextStep);
    },
    [controlledActiveStep, onActiveStepChange],
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreationSuccessOpen, setIsCreationSuccessOpen] = useState(false);
  const confirmationResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const requestConfirmation = (message: string): Promise<boolean> => {
    setConfirmationMessage(message);
    return new Promise((resolve) => {
      confirmationResolverRef.current = resolve;
    });
  };
  const resolveConfirmation = (approved: boolean) => {
    confirmationResolverRef.current?.(approved);
    confirmationResolverRef.current = null;
    setConfirmationMessage(null);
  };
  // 기존 고객을 선택했는데 계약서 입력값이 저장된 고객 정보와 다르면, 제출 전에 고객 정보도 수정할지 물어봐요.
  const clientDiffResolverRef = useRef<((decision: ClientDiffDecision) => void) | null>(null);
  const [clientDiffPrompt, setClientDiffPrompt] = useState<ClientDiffPrompt | null>(null);
  const requestClientDiffDecision = (prompt: ClientDiffPrompt): Promise<ClientDiffDecision> => {
    setClientDiffPrompt(prompt);
    return new Promise((resolve) => {
      clientDiffResolverRef.current = resolve;
    });
  };
  const resolveClientDiffDecision = (decision: ClientDiffDecision) => {
    clientDiffResolverRef.current?.(decision);
    clientDiffResolverRef.current = null;
    setClientDiffPrompt(null);
  };
  // 선택된 기존 고객의 저장값. 고객 정보를 함께 수정하면 수정된 값으로 갱신해요.
  const loadedClientBaselineRef = useRef<LoadedClientBaseline | null>(null);
  // 위 ref와 같은 저장값을 렌더링에서 쓰기 위한 복사본이에요. 필드별 "등록된 정보와 달라요." 힌트와 placeholder가 읽어요.
  const [registeredBaseline, setRegisteredBaseline] = useState<LoadedClientBaseline | null>(null);
  // "계약서에만 반영"을 고른 입력값. 같은 입력으로 다시 제출하면 다시 묻지 않아요.
  const contractOnlyChoiceRef = useRef<{ clientId: number; formKey: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [allowIframeFallback, setAllowIframeFallback] = useState(false);
  // Kept out of `submitError` on purpose: opening the iframe fallback re-enters
  // handleContractCreation, which clears submitError. This warning has to outlive
  // that, because it is the only thing standing between staff and a duplicate
  // contract when the dispatch outcome is unknown.
  const [unverifiedDispatchNotice, setUnverifiedDispatchNotice] = useState<string | null>(null);
  const [creationProgress, setCreationProgress] = useState<HeadlessProgressState>(INITIAL_CREATION_PROGRESS);
  const persistedClientIdRef = useRef<number | null>(null);
  const persistedClientSnapshotRef = useRef<string | null>(null);
  const retryWithPersistedClientRef = useRef(false);
  const [dueDateInput, setDueDateInput] = useState("");
  const [birthDateInput, setBirthDateInput] = useState("");
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");
  // 필드별 입력 이력(값을 가졌었는지, 떠났는지, 포커스 중인지). 메시지는 이 이력으로 정해져요.
  const fields = useFieldInputStates<ContractInputField>();
  const resetFieldStates = fields.reset;
  const onFieldInputChange = fields.onChange;
  // 계속하기/제출을 눌러 본 단계. 이 단계의 문제 필드는 모두 메시지를 보여줘요.
  const [attemptedSteps, setAttemptedSteps] = useState<readonly number[]>([]);
  const pendingFocusRef = useRef<{ target: ContractFocusTarget; step: number } | null>(null);

  const { isLoaded: isEformsignLoaded, isLoading: isEformsignLoading, error: eformsignError, openDocument } =
    useEformsign();

  const handleCreationSuccessAcknowledged = () => {
    if (!isCreationSuccessOpen) return;
    setIsCreationSuccessOpen(false);
    onSuccess?.();
  };

  const {
    clientId,
    name,
    phone,
    birthday,
    address,
    dueDate,
    birthDate,
    employeeId,
    employeeName,
    employeePhone,
    showEmployee2,
    employee2Id,
    employee2Name,
    employee2Phone,
    startDate,
    endDate,
    paymentDate,
    fullPrice,
    grant,
    actualPrice,
    voucherType,
    voucherDuration,
    voucherYear,
    area,
    setClientId,
    setName,
    setPhone,
    setBirthday,
    setAddress,
    setDueDate,
    setBirthDate,
    setIsEmployeeManualEntry,
    setEmployeePhone,
    setEmployeeSelection,
    resetEmployeeFields,
    setShowEmployee2,
    setIsEmployee2ManualEntry,
    setEmployee2Phone,
    setEmployee2Selection,
    resetEmployee2Fields,
    setStartDate,
    setEndDate,
    setPaymentDate,
    setFullPrice,
    setGrant,
    setActualPrice,
    setVoucherType,
    setVoucherDuration,
    setVoucherYear,
    setArea,
    resetAll,
  } = useFormStore();

  // Sync display inputs when external date state changes (e.g., client autofill).
  useEffect(() => { setDueDateInput(toIsoDateOnly(dueDate)); }, [dueDate]);
  useEffect(() => { setBirthDateInput(toIsoDateOnly(birthDate)); }, [birthDate]);
  useEffect(() => { setStartDateInput(startDate); }, [startDate]);
  useEffect(() => { setEndDateInput(endDate); }, [endDate]);
  useEffect(() => { setPaymentDateInput(paymentDate); }, [paymentDate]);

  // 출산 예정일·출산일은 YYYY-MM-DD로 입력해요. 실제 있는 날짜가 되면 같은 ISO 문자열이 저장돼요.
  const handleDueDateInputChange = useCallback((value: string) => {
    const nextInput = formatIsoDateInput(value);
    onFieldInputChange("dueDate", dueDateInput, nextInput);
    setDueDateInput(nextInput);

    if (nextInput.length === 0) {
      setDueDate("");
    } else if (isRealIsoDate(nextInput)) {
      setDueDate(nextInput);
    }
  }, [dueDateInput, onFieldInputChange, setDueDate]);

  const handleBirthDateInputChange = useCallback((value: string) => {
    const nextInput = formatIsoDateInput(value);
    onFieldInputChange("birthDate", birthDateInput, nextInput);
    setBirthDateInput(nextInput);

    if (nextInput.length === 0) {
      setBirthDate("");
    } else if (isRealIsoDate(nextInput)) {
      setBirthDate(nextInput);
    }
  }, [birthDateInput, onFieldInputChange, setBirthDate]);

  // 시작일과 서비스 기간이 모두 정해지면 평일(주말+한국 공휴일 제외) 기준으로 종료일 자동 계산.
  // 사용자가 종료일을 수동 편집해도 startDate/voucherDuration이 다시 바뀌어야만 덮어쓴다.
  useEffect(() => {
    if (!startDate || !voucherDuration) return;
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const computed = calcEndDateBusinessDays(startDate, n);
    if (computed) setEndDate(computed);
  }, [startDate, voucherDuration, setEndDate]);

  const isProcessingStep = activeStep === CONTRACT_CREATION_PROCESSING_STEP_INDEX;
  const hasCreationSession = isProcessingStep && creationProgress.step !== null;
  const hasProcessingFailure = hasCreationSession && creationProgress.failed;
  const hasProcessingSuccess = hasCreationSession && creationProgress.completed;

  useEffect(() => {
    onSessionStateChange?.(hasCreationSession);
  }, [hasCreationSession, onSessionStateChange]);

  useEffect(() => {
    onProcessingFailureChange?.(hasProcessingFailure);
  }, [hasProcessingFailure, onProcessingFailureChange]);

  const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(
    voucherType,
    voucherYear
  );
  const {
    data: areaTemplates = [],
    isError: isAreaTemplatesError,
    isFetching: isAreaTemplatesFetching,
    isLoading: isAreaTemplatesLoading,
    refetch: refetchAreaTemplates,
  } = useAreaTemplates();
  const isAreaTemplatesEmpty = !isAreaTemplatesLoading && !isAreaTemplatesError && areaTemplates.length === 0;
  const isAreaTemplateSelectDisabled = isAreaTemplatesLoading || isAreaTemplatesError || isAreaTemplatesEmpty;
  const isAreaTemplateSelectionValid =
    !isAreaTemplatesLoading &&
    !isAreaTemplatesError &&
    areaTemplates.some((template) => template.areaId === area);
  const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();
  const { data: employees } = useEmployees();
  const createClientMutation = useCreateClient();
  const deleteClientMutation = useDeleteClient();
  const updateClientMutation = useUpdateClient();
  const enqueueCreationMutation = useEnqueueEformsignDocumentCreation();
  const stepLabels = t(locale, "contract-msg.pagination-steps") as unknown as string[];

  const handleVoucherYearChange = (value: number) => {
    setVoucherYear(value);
    setVoucherType("");
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  const handleVoucherTypeChange = (value: string) => {
    setVoucherType(value);
    setVoucherDuration("");
    setFullPrice("");
    setGrant("");
    setActualPrice("");
  };

  const handleDurationChange = (duration: string) => {
    const selectedVoucher = voucherPriceInfos.find((v) => v.duration === duration);
    if (selectedVoucher) {
      setVoucherDuration(duration);
      setFullPrice(selectedVoucher.fullPrice?.toString() ?? "");
      setGrant(selectedVoucher.grant?.toString() ?? "");
      setActualPrice(selectedVoucher.actualPrice?.toString() ?? "");
    }
  };

  const handleDialogClose = () => {
    setCreationProgress((current) =>
      current.step !== null && !current.completed && !current.failed
        ? { ...current, failed: true }
        : current,
    );
    setIsDialogOpen(false);
    setIsSubmitting(false);
  };

  const resetCreationSession = () => {
    setIsDialogOpen(false);
    setIsSubmitting(false);
    setSubmitError(null);
    setAllowIframeFallback(false);
    setUnverifiedDispatchNotice(null);
    setCreationProgress(INITIAL_CREATION_PROGRESS);
    persistedClientIdRef.current = null;
    persistedClientSnapshotRef.current = null;
    retryWithPersistedClientRef.current = false;
    contractOnlyChoiceRef.current = null;
    resetFieldStates();
    setAttemptedSteps([]);
    pendingFocusRef.current = null;
  };

  const handleCancel = () => {
    resetAll();
    setDueDateInput("");
    resetCreationSession();
    setActiveStep(0);
    onSessionStateChange?.(false);
    if (onClose) onClose();
    else router.push("/contracts");
  };

  const handleStartNewContractCreation = () => {
    resetAll();
    setDueDateInput("");
    resetCreationSession();
    setActiveStep(0);
    onSessionStateChange?.(false);
  };

  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    persistedClientIdRef.current = null;
    persistedClientSnapshotRef.current = null;
    retryWithPersistedClientRef.current = false;
    contractOnlyChoiceRef.current = null;
    // 다른 고객의 값으로 바뀌므로 이전 입력 이력과 메시지는 비워요.
    resetFieldStates();
    setAttemptedSteps([]);
    const nextBaseline: LoadedClientBaseline | null = selectedClientId !== null && client
      ? {
        id: selectedClientId,
        snapshot: buildClientDiffSnapshotFromClient(client),
        periodLocked: client.serviceRecordPeriodLocked === true,
      }
      : null;
    loadedClientBaselineRef.current = nextBaseline;
    setRegisteredBaseline(nextBaseline);
    setClientId(selectedClientId);
    resetEmployeeFields();
    resetEmployee2Fields();

    if (client) {
      setName(client.name);
      setPhone(client.phone || "");
      setBirthday(normalizeBirthdayIsoDate(client.birthday) ?? client.birthday ?? "");
      setAddress(client.address || "");
      setDueDate(client.dueDate || "");
      setDueDateInput(toIsoDateOnly(client.dueDate || ""));
      setBirthDate(client.birthDate || "");
      setBirthDateInput(toIsoDateOnly(client.birthDate || ""));

      if (client.type) {
        setVoucherType(client.type);
      }
      if (client.duration) {
        setVoucherDuration(client.duration.toString());
      }
      if (client.fullPrice) {
        setFullPrice(client.fullPrice);
      }
      if (client.grant) {
        setGrant(client.grant);
      }
      if (client.actualPrice) {
        setActualPrice(client.actualPrice);
      }
      const clientStartDate = toIsoDateOnly(client.startDate ?? "");
      if (clientStartDate) {
        setStartDate(clientStartDate);
        setPaymentDate(clientStartDate);
      }
      const clientEndDate = toIsoDateOnly(client.endDate ?? "");
      if (clientEndDate) {
        setEndDate(clientEndDate);
      }

      if (client.primaryEmployee && employees) {
        const primaryEmp = employees.find((e) => e.id === client.primaryEmployee?.id);
        if (primaryEmp) {
          setEmployeeSelection(primaryEmp.id, primaryEmp.name, primaryEmp.phone);
          setIsEmployeeManualEntry(false);
        }
      }

      if (client.secondaryEmployee && employees) {
        const secondaryEmp = employees.find((e) => e.id === client.secondaryEmployee?.id);
        if (secondaryEmp) {
          setShowEmployee2(true);
          setEmployee2Selection(secondaryEmp.id, secondaryEmp.name, secondaryEmp.phone);
          setIsEmployee2ManualEntry(false);
        }
      }
    } else {
      setName("");
      setPhone("");
      setBirthday("");
      setAddress("");
      setDueDate("");
      setDueDateInput("");
      setBirthDate("");
      setBirthDateInput("");
      setVoucherType("");
      setVoucherDuration("");
      setFullPrice("");
      setGrant("");
      setActualPrice("");
      setStartDate("");
      setEndDate("");
      resetEmployeeFields();
      resetEmployee2Fields();
    }
  };

  const initialClientAppliedRef = useRef(false);

  useEffect(() => {
    if (!initialClient || initialClientAppliedRef.current) return;
    initialClientAppliedRef.current = true;

    resetAll();
    setDueDateInput("");
    setBirthDateInput("");
    resetCreationSession();

    handleClientSelect(initialClient.id, initialClient);
    setArea(initialClient.areaId ?? "");
    setPaymentDate("");
    setPaymentDateInput("");
  }, [initialClient]);

  const initialClientEmployeePrefillAppliedRef = useRef(false);

  useEffect(() => {
    if (!initialClient || !employees || initialClientEmployeePrefillAppliedRef.current) return;
    if (employeeId !== null || employeeName || employeePhone) return;
    initialClientEmployeePrefillAppliedRef.current = true;

    if (initialClient.primaryEmployee) {
      const primaryEmp = employees.find((e) => e.id === initialClient.primaryEmployee?.id);
      if (primaryEmp) {
        setEmployeeSelection(primaryEmp.id, primaryEmp.name, primaryEmp.phone);
        setIsEmployeeManualEntry(false);
      }
    }

    if (initialClient.secondaryEmployee) {
      const secondaryEmp = employees.find((e) => e.id === initialClient.secondaryEmployee?.id);
      if (secondaryEmp) {
        setShowEmployee2(true);
        setEmployee2Selection(secondaryEmp.id, secondaryEmp.name, secondaryEmp.phone);
        setIsEmployee2ManualEntry(false);
      }
    }
  }, [
    initialClient,
    employees,
    employeeId,
    employeeName,
    employeePhone,
    setEmployeeSelection,
    setIsEmployeeManualEntry,
    setShowEmployee2,
    setEmployee2Selection,
    setIsEmployee2ManualEntry,
  ]);

  const handleEmployeeSelect = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      setEmployeeSelection(selectedEmployeeId, employee.name, employee.phone);
      setIsEmployeeManualEntry(false);
    } else {
      setEmployeeSelection(null, "", "");
      setIsEmployeeManualEntry(false);
    }
  };

  const handleEmployee2Select = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) {
      setEmployee2Selection(selectedEmployeeId, employee.name, employee.phone);
      setIsEmployee2ManualEntry(false);
    } else {
      setEmployee2Selection(null, "", "");
      setIsEmployee2ManualEntry(false);
    }
  };

  const handleToggleShowEmployee2 = () => {
    if (showEmployee2) {
      resetEmployee2Fields();
    } else {
      setShowEmployee2(true);
    }
  };

  const markCreationProgressFailed = () => {
    setCreationProgress((current) => ({
      step: current.step ?? "client-started",
      completed: false,
      failed: true,
    }));
  };

  const markStepAttempted = (step: number) => {
    setAttemptedSteps((previous) => (previous.includes(step) ? previous : [...previous, step]));
  };

  const handleContractCreation = async ({ mode = "auto" }: ContractCreationRunOptions = {}) => {
    if (isSubmittingRef.current) return;
    const dateProblem = getFirstProblemTarget(CONTRACT_INFO_STEP_INDEX);
    if (dateProblem) {
      requestFieldFocus(dateProblem, CONTRACT_INFO_STEP_INDEX);
      return;
    }
    if (!isAreaTemplateSelectionValid) {
      // 문제는 계약서 선택 필드의 라벨 줄 메시지로 보여줘요.
      markStepAttempted(CONTRACT_CUSTOMER_INFO_STEP_INDEX);
      setActiveStep(CONTRACT_CUSTOMER_INFO_STEP_INDEX);
      return;
    }
    isSubmittingRef.current = true;
    onSubmissionStateChange?.(true);
    try {
      const shouldEnqueueDocumentJob = mode !== "manual" && isFeatureEnabled("eformsignDocumentJobs");
      const shouldAttemptHeadless = !shouldEnqueueDocumentJob
        && mode !== "manual"
        && isFeatureEnabled("headlessDispatch");

      if (employeeId === null || (showEmployee2 && employee2Id === null)) {
        // 문제는 제공인력 선택 필드의 라벨 줄 메시지로 보여줘요.
        markStepAttempted(1);
        setActiveStep(1);
        return;
      }

      if (!shouldEnqueueDocumentJob && !shouldAttemptHeadless && !isEformsignLoaded) {
        setSubmitError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
        setActiveStep(CONTRACT_INFO_STEP_INDEX);
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);
      // A manual run is usually the automatic iframe fallback re-entering after a
      // failure, so it must not wipe the warning that failure just raised. Only a
      // genuinely fresh attempt clears it.
      if (mode !== "manual") setUnverifiedDispatchNotice(null);
      setIsDialogOpen(false);
      setCreationProgress(INITIAL_CREATION_PROGRESS);

      let autoRegisteredClientId: number | null = null;
      let keepSubmittingUntilDialogCloses = false;
      try {
        const reusePersistedClient = retryWithPersistedClientRef.current;
        retryWithPersistedClientRef.current = false;
        let finalClientId = reusePersistedClient
          ? persistedClientIdRef.current ?? clientId
          : clientId;
        const normalizedDueDate = toRealIsoDate(dueDateInput) ?? "";
        const normalizedBirthDate = toRealIsoDate(birthDateInput) ?? "";
        const assignment = {
          primaryEmployeeId: employeeId,
          secondaryEmployeeId: showEmployee2 ? employee2Id : null,
        };
        const clientPersistenceSnapshot = serializeClientPersistencePayload({
          ...assignment,
          name,
          phone,
          birthday: birthday || null,
          address: address || null,
          dueDate: normalizedDueDate || null,
          birthDate: normalizedBirthDate || null,
          type: voucherType || null,
          duration: parseOptionalInteger(voucherDuration),
          fullPrice: fullPrice || null,
          grant: grant || null,
          actualPrice: actualPrice || null,
          startDate: startDate || null,
          endDate: endDate || null,
          voucherClient: hasPositivePrice(grant),
          areaId: area || null,
        });

        // 기존 고객을 골랐고 입력값이 저장된 고객 정보와 다르면 어떻게 반영할지 먼저 물어봐요.
        // 자동 등록·새로 만든 고객은 이 확인을 거치지 않아요.
        const loadedBaseline = clientId !== null && loadedClientBaselineRef.current?.id === clientId
          ? loadedClientBaselineRef.current
          : null;
        const omitPeriodFields = loadedBaseline?.periodLocked === true;
        let clientUpdateMode: "full" | "assignment-only" | "skip" = "full";
        let formDiffSnapshot: ClientDiffSnapshot | null = null;
        if (loadedBaseline && clientId !== null) {
          const formSnapshot = buildClientDiffSnapshotFromForm({
            name,
            phone,
            birthday,
            address,
            dueDate: normalizedDueDate,
            birthDate: normalizedBirthDate,
            areaId: area,
            areaTemplateName: areaTemplates.find((template) => template.areaId === area)?.templateName,
            primaryEmployeeId: assignment.primaryEmployeeId,
            primaryEmployeeName: employeeName,
            secondaryEmployeeId: assignment.secondaryEmployeeId,
            secondaryEmployeeName: employee2Name,
            type: voucherType,
            duration: voucherDuration,
            fullPrice,
            grant,
            actualPrice,
            startDate,
            endDate,
          });
          formDiffSnapshot = formSnapshot;
          const diffRows = diffClientSnapshots(locale, loadedBaseline.snapshot, formSnapshot);
          const formKey = serializeClientDiffSnapshot(formSnapshot);
          const previousChoice = contractOnlyChoiceRef.current;
          let decision: ClientDiffDecision = "update-client";
          if (diffRows.length === 0) {
            clientUpdateMode = "skip";
          } else if (previousChoice?.clientId === clientId && previousChoice.formKey === formKey) {
            decision = "contract-only";
          } else {
            decision = await requestClientDiffDecision({
              rows: diffRows,
              showPeriodLockedNote: omitPeriodFields && diffRows.some((row) => CLIENT_PERIOD_DIFF_KEYS.has(row.key)),
            });
            if (decision === "cancel") {
              setActiveStep(CONTRACT_INFO_STEP_INDEX);
              return;
            }
          }
          if (decision === "contract-only") {
            contractOnlyChoiceRef.current = { clientId, formKey };
            // 저장된 고객에 주 담당 인력이 없으면 배정만은 저장해요.
            clientUpdateMode = loadedBaseline.snapshot.primaryEmployeeId.value === null
              && assignment.primaryEmployeeId !== null
              ? "assignment-only"
              : "skip";
          }
        }

        if (!reusePersistedClient && !clientId) {
          const autoRegistrationPayload = {
            name,
            phone,
            birthday: birthday || undefined,
            address: address || undefined,
            dueDate: normalizedDueDate || undefined,
            birthDate: normalizedBirthDate || undefined,
            ...assignment,
            type: voucherType || null,
            duration: parseOptionalInteger(voucherDuration),
            fullPrice: fullPrice || null,
            grant: grant || null,
            actualPrice: actualPrice || null,
            startDate: startDate || null,
            endDate: endDate || null,
            careCenter: null,
            voucherClient: hasPositivePrice(grant),
            breastPump: false,
            serviceStatus: isFutureDate(startDate) ? "waiting" as const : null,
            areaId: area || null,
            source: "contract_auto_registration" as const,
          };
          let newClient;
          let reusedExistingClient = false;
          try {
            newClient = await createClientMutation.mutateAsync(autoRegistrationPayload);
          } catch (error) {
            if (!isAxiosError<{ message?: string; error?: string; clientId?: number; code?: string }>(error) || error.response?.status !== 409) throw error;
            const conflict = error.response.data;
            // 중복 판별은 공개 계약 코드로 하고, 배포 전환 구간에는 레거시
            // clientId 페이로드도 받아든다.
            const isDuplicatePhone = conflict.code === "CLIENT_PHONE_ALREADY_REGISTERED" || Boolean(conflict.clientId);
                        if (!isDuplicatePhone) {
              // Locally authored copy — the upstream conflict body is never
              // stringified into the error.
              throw new AuthoredSubmissionError("고객 자동 등록에 실패했어요.");
            }
            const shouldReuse = await requestConfirmation("이미 같은 전화번호의 고객이 있습니다. 기존 고객으로 계약을 진행할까요?");
            if (!shouldReuse) return;
            reusedExistingClient = true;
            newClient = await createClientMutation.mutateAsync({ ...autoRegistrationPayload, reuseExistingClient: true });
          }
          finalClientId = newClient.id;
          if (!reusedExistingClient) autoRegisteredClientId = newClient.id;
          setClientId(newClient.id);
        }
        const shouldUpdatePersistedClient = clientUpdateMode === "skip"
          ? false
          : reusePersistedClient
            ? persistedClientSnapshotRef.current !== clientPersistenceSnapshot
            : clientId !== null;
        if (shouldUpdatePersistedClient) {
          if (finalClientId === null) {
            throw new Error("고객 정보를 먼저 선택하거나 등록해 주세요.");
          }
          await updateClientMutation.mutateAsync({
            id: finalClientId,
            dto: clientUpdateMode === "assignment-only"
              ? { ...assignment }
              : {
                ...assignment,
                name,
                phone,
                birthday: birthday || undefined,
                address: address || null,
                dueDate: normalizedDueDate || undefined,
                birthDate: normalizedBirthDate || null,
                type: voucherType || null,
                fullPrice: fullPrice || null,
                grant: grant || null,
                actualPrice: actualPrice || null,
                // 서비스 기록이 확정된 고객은 계약 기간을 계약서에만 반영해요. 키를 빼면 저장된 값이 그대로 남아요.
                ...(omitPeriodFields
                  ? {}
                  : {
                    duration: parseOptionalInteger(voucherDuration),
                    startDate: startDate || null,
                    endDate: endDate || null,
                  }),
                voucherClient: hasPositivePrice(grant),
                areaId: area || null,
              },
          });
          // 저장된 값이 바뀌었으니 다음 비교는 방금 저장한 값을 기준으로 해요.
          if (loadedBaseline && formDiffSnapshot) {
            const persistedSnapshot: ClientDiffSnapshot = { ...loadedBaseline.snapshot };
            for (const key of CLIENT_DIFF_KEYS) {
              const isAssignmentKey = key === "primaryEmployeeId" || key === "secondaryEmployeeId";
              if (clientUpdateMode === "assignment-only" && !isAssignmentKey) continue;
              if (omitPeriodFields && CLIENT_PERIOD_DIFF_KEYS.has(key)) continue;
              persistedSnapshot[key] = formDiffSnapshot[key];
            }
            loadedBaseline.snapshot = persistedSnapshot;
            setRegisteredBaseline({ ...loadedBaseline, snapshot: persistedSnapshot });
          }
        }
        if (finalClientId === null) {
          throw new AuthoredSubmissionError("고객 정보를 먼저 선택하거나 등록해 주세요.");
        }
        if (!reusePersistedClient || shouldUpdatePersistedClient) {
          persistedClientIdRef.current = finalClientId;
          persistedClientSnapshotRef.current = clientPersistenceSnapshot;
        }

        const start = dayjs(startDate);
        const end = endDate ? dayjs(endDate) : null;
        const payment = dayjs(paymentDate);
        const today = dayjs();

        const contractData: ContractDataDto = {
          customerName: name,
          customerContact: phone,
          customerDOB: birthday,
          customerAddress: address,
          // 발급자 연락처 메타데이터는 유지하며, 계약서 이용자 연락처는 customerContact를 사용합니다.
          issuerPhone: authUser?.phone ?? undefined,
          caretaker1Name: employeeName,
          caretaker1Contact: employeePhone,
          type: voucherType,
          days: voucherDuration,
          area,
          contractDuration: end
            ? `${start.format("YYYY-MM-DD")} ~ ${end.format("YYYY-MM-DD")}`
            : `${start.format("YYYY-MM-DD")} ~`,
          startYear: start.format("YY"),
          startMonth: start.format("MM"),
          startDay: start.format("DD"),
          startDate,
          endYear: end ? end.format("YY") : "",
          endMonth: end ? end.format("MM") : "",
          endDay: end ? end.format("DD") : "",
          endDate,
          paymentYear: payment.format("YY"),
          paymentMonth: payment.format("MM"),
          paymentDay: payment.format("DD"),
          receiptYear: today.format("YY"),
          receiptMonth: today.format("MM"),
          receiptDay: today.format("DD"),
          fullPrice,
          grant,
          actualPrice,
        };

        if (shouldEnqueueDocumentJob) {
          await enqueueCreationMutation.mutateAsync({
            requestKey: createHeadlessProgressId(),
            clientId: finalClientId,
            contractData,
          });
          toast({ description: "전자문서 작업을 시작했어요" });
          if (onSuccess) onSuccess();
          else onClose?.();
          return;
        }

        // BJJ-90: when the flag is on, drive the iframe gate sequence on the
        // backend via Playwright. Failures stay on the processing step so the
        // user can retry the backend run or choose the manual iframe fallback.
        if (shouldAttemptHeadless) {
          const progressId = createHeadlessProgressId();
          let progressSource: ReturnType<typeof createReconnectingEventSource> | null = null;

          // Reopen the eformsign editor so staff are never stranded on a failed
          // automatic run. Deferred a tick so this run's `finally` (which clears
          // isSubmitting) lands before the manual run sets it again.
          const openIframeFallback = () => {
            setTimeout(() => {
              void handleContractCreation({ mode: "manual" });
            }, 0);
          };

          try {
            setCreationProgress({ step: "client-started", completed: false, failed: false });
            progressSource = createReconnectingEventSource({
              eventName: "progress",
              url: `/api/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
              onEvent: (event) => {
                let data: HeadlessProgressEvent;
                try {
                  data = JSON.parse(event.data) as HeadlessProgressEvent;
                } catch {
                  return;
                }
                if (data.step === "failed") {
                  setSubmitError(getSafeHeadlessFailureMessage(data.reason));
                  setCreationProgress((current) => ({
                    step: data.failedStep && isHeadlessProgressStepKey(data.failedStep)
                      ? data.failedStep
                      : current.step ?? "client-started",
                    completed: false,
                    failed: true,
                  }));
                  return;
                }
                if (!isHeadlessProgressStepKey(data.step)) return;
                const nextStep = data.step;
                setCreationProgress((current) =>
                  current.failed
                    ? current
                    : {
                      step: nextStep,
                      completed: nextStep === "sent",
                      failed: false,
                    },
                );
              },
            });

            const headless = await eformsignApi.dispatchHeadless(
              contractData,
              finalClientId,
              progressId,
            );

            if (headless.ok) {
              setCreationProgress({ step: "sent", completed: true, failed: false });
              queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
              setIsCreationSuccessOpen(true);
              return;
            }

            // Dev: these exact backend reasons are guaranteed before the provider
            // send boundary. Keep the existing client and allow a safe retry;
            // the iframe fallback is not a valid recovery for this failure.
            const knownHeadlessFailureMessage = getKnownHeadlessProviderFailureMessage(headless.reason);
            if (knownHeadlessFailureMessage) {
              setAllowIframeFallback(false);
              setSubmitError(getUserErrorMessage(knownHeadlessFailureMessage));
              retryWithPersistedClientRef.current = true;
              setCreationProgress((current) => ({
                step: headless.failedStep && isHeadlessProgressStepKey(headless.failedStep)
                  ? headless.failedStep
                  : current.step ?? "client-started",
                completed: false,
                failed: true,
              }));
              return;
            }

            // BJJ-319 5-4c: the structured outcome is the primary classification
            // when the envelope carries it. An UNKNOWN verdict means the provider
            // send boundary may already be crossed, so the only safe recovery is
            // the durable 확인 필요 notice — no iframe, no automatic retry. A
            // PARTIALLY_APPLIED verdict joins the local-persist adopt/check-list
            // recovery below. Envelopes without the field keep the legacy
            // reason/fallbackHint branches underneath.
            const structuredOutcome = readHeadlessOutcome(headless.outcome);
            if (structuredOutcome === "UNKNOWN") {
              setAllowIframeFallback(false);
              setUnverifiedDispatchNotice(
                "자동 생성 결과를 확인하지 못했습니다. 전자문서 목록에서 생성 여부를 먼저 확인하시고, "
                + "확인 전에는 새 계약서를 만들지 마세요.",
              );
              markCreationProgressFailed();
              return;
            }

            if ((headless.reason === "local_persist_failed" || structuredOutcome === "PARTIALLY_APPLIED") && headless.remoteDocumentId) {
              try {
                const adopted = await eformsignApi.adoptDocument(
                  headless.remoteDocumentId,
                  finalClientId,
                );
                if (adopted.warnings?.includes("mirror_sync_failed")) {
                  queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
                  setSubmitError(
                    "문서는 생성·전송되었지만 전자문서와 PDF 동기화가 완료되지 않았습니다. "
                    + "새 계약서를 다시 만들지 말고 잠시 후 전자문서 목록에서 확인해 주세요.",
                  );
                  markCreationProgressFailed();
                  return;
                }
                setCreationProgress({ step: "sent", completed: true, failed: false });
                queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
                setIsCreationSuccessOpen(true);
              } catch {
                setSubmitError("문서는 생성되었으나 등록에 실패했어요. 잠시 후 다시 시도해 주세요.");
                markCreationProgressFailed();
              }
              return;
            }
            if (structuredOutcome === "PARTIALLY_APPLIED") {
              // The verdict says the document exists but could not be adopted
              // here and no remote id was provided to retry the adoption with.
              // Reuse the existing check-list copy: check the list, do not
              // re-create the contract.
              setSubmitError("문서는 생성·전송되었지만 전자문서와 PDF 동기화가 완료되지 않았습니다. "
                + "새 계약서를 다시 만들지 말고 잠시 후 전자문서 목록에서 확인해 주세요.");
              markCreationProgressFailed();
              return;
            }
            if (headless.reason === "remote_unconfirmed" || headless.fallbackHint === "adopt-or-manual" || headless.fallbackHint === "manual_check") {
              setSubmitError("문서 생성 상태를 확인할 수 없어요. 전자문서 목록에서 확인 후 다시 시도해 주세요.");
              markCreationProgressFailed();
              return;
            }
            if (headless.reason === "duplicate_pending_document") {
              setSubmitError("최근 생성된 진행 중 문서가 있습니다.");
              markCreationProgressFailed();
              if (await requestConfirmation("최근 생성된 진행 중 문서가 있습니다. 그래도 새로 생성하시겠습니까?")) {
                const forced = await eformsignApi.dispatchHeadless(contractData, finalClientId, progressId, true);
                if (forced.ok) {
                  setCreationProgress({ step: "sent", completed: true, failed: false });
                  queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
                  setIsCreationSuccessOpen(true);
                }
              }
              return;
            }

            console.warn(
              "[contract-creation] headless dispatch returned ok=false",
              headless.reason,
            );
            const canFallBackToIframe = headless.fallbackHint === "iframe";
            setAllowIframeFallback(canFallBackToIframe);
            setSubmitError(getSafeHeadlessFailureMessage(headless.reason));
            setCreationProgress((current) => ({
              step: headless.failedStep && isHeadlessProgressStepKey(headless.failedStep)
                ? headless.failedStep
                : current.step ?? "client-started",
              completed: false,
              failed: true,
            }));
            if (canFallBackToIframe) {
              // fallbackHint:"iframe" is the backend stating it got far enough to
              // know nothing was sent, so reopening the editor cannot duplicate.
              openIframeFallback();
            }
            return;
          } catch (headlessError) {
            console.warn(
              "[contract-creation] headless dispatch threw",
              headlessError,
            );
            // The backend's verdict never reached us, so whether the document was
            // sent is genuinely unknown. Reopening the editor here can send a second
            // contract; require a list check before any explicit retry.
            setAllowIframeFallback(false);
            setUnverifiedDispatchNotice(
              "자동 생성 결과를 확인하지 못했습니다. 전자문서 목록에서 생성 여부를 먼저 확인하시고, "
              + "확인 전에는 새 계약서를 만들지 마세요.",
            );
            markCreationProgressFailed();
            return;
          } finally {
            progressSource?.close();
          }
        }

        if (!isEformsignLoaded) {
          setSubmitError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
          setActiveStep(CONTRACT_INFO_STEP_INDEX);
          return;
        }

        const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
          contractData,
          finalClientId
        );

        keepSubmittingUntilDialogCloses = true;
        setIsDialogOpen(true);
        setCreationProgress({ step: "client-started", completed: false, failed: false });

        setTimeout(() => {
          openDocument(documentOption, "eformsign_iframe", {
            onSuccess: async (response) => {
              setCreationProgress({ step: "creating", completed: false, failed: false });
              if (finalClientId && response.document_id) {
                try {
                  await eformsignApi.createDocRecord({
                    documentId: response.document_id,
                    clientId: finalClientId,
                    statusType: "060",
                    statusDetail: "대기",
                    stepType: "01",
                    stepIndex: "1",
                    stepName: "서명 요청",
                    stepRecipientType: "01",
                    stepRecipientName: name,
                    stepRecipientSms: phone,
                    expiredDate: (end ?? start.add(60, "day")).add(30, "day").toISOString(),
                    linkToClient: true,
                    documentKind: "contract",
                    templateId: documentOption.mode.template_id ?? null,
                  });
                } catch (docError) {
                  console.error("Failed to create eformsign doc record:", docError);
                }
              }

              setCreationProgress({ step: "sent", completed: true, failed: false });
              queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
              handleDialogClose();
              setIsCreationSuccessOpen(true);
            },
            onError: (response) => {
              // The vendor message is never forwarded; locally authored copy
              // covers the SDK failure. The vendor code stays a diagnostic.
              console.error("Document creation failed:", response.code);
              markCreationProgressFailed();
              setSubmitError("문서 생성에 실패했어요. 잠시 후 다시 시도해 주세요.");
              handleDialogClose();
            },
            onAction: () => {
              setCreationProgress((current) =>
                current.step === "client-started" && !current.completed && !current.failed
                  ? { step: "info-inserted", completed: false, failed: false }
                  : current,
              );
            },
          });
        }, 500);
      } catch (error) {
        // Locally authored copy keeps its message; otherwise the registered
        // problem message (verified) or the generic fallback is rendered —
        // upstream internals are never surfaced.
        const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
        const creationFailureCopy = error instanceof AuthoredSubmissionError
          ? error.message
          : normalized.verified ? normalized.message : "계약서 생성 중 오류가 발생했어요.";
        if (autoRegisteredClientId) {
          setSubmitError(`${creationFailureCopy} 방금 자동 등록된 고객이 남아 있어요.`);
          if (await requestConfirmation("방금 자동 등록된 고객이 남아 있습니다. 고객을 삭제할까요?")) {
            try {
              await deleteClientMutation.mutateAsync(autoRegisteredClientId);
              setClientId(null);
            } catch (deleteError) {
              if (isAxiosError(deleteError)) {
                const normalizedDelete = normalizeApiError(deleteError, { locale: "ko-KR", operation: "mutation" });
                setSubmitError(normalizedDelete.verified ? normalizedDelete.message : "고객 삭제에 실패했어요.");
              }
            }
          }
        }
        console.error("Error creating contract:", error);
        setIsDialogOpen(false);
        setActiveStep(CONTRACT_INFO_STEP_INDEX);
        markCreationProgressFailed();
        if (!autoRegisteredClientId) {
          setSubmitError(creationFailureCopy);
        }
      } finally {
        if (!keepSubmittingUntilDialogCloses) {
          setIsSubmitting(false);
        }
      }
    } finally {
      isSubmittingRef.current = false;
      onSubmissionStateChange?.(false);
    }
  };

  const isStep1Valid = Boolean(name.trim() && phone.trim() && isAreaTemplateSelectionValid);
  const isEmployee1Valid = employeeId !== null;
  const isEmployee2Valid = !showEmployee2 || employee2Id !== null;
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  // 날짜·연락처 형식 문제는 다음/제출을 막는 대신 눌렀을 때 해당 필드에 메시지를 보여주고 그 필드로 이동해요.
  // endDate는 이용자 서명 후 직원이 Step 3에서 사후 입력하므로 발급 시점에는 옵셔널.
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, true][activeStep] ?? true;
  const requiredFieldProgressText = `필수 항목 11개 중 ${
    [
      Boolean(name.trim()),
      Boolean(phone.trim()),
      Boolean(area),
      isEmployee1Valid,
      Boolean(voucherType),
      Boolean(voucherDuration),
      Boolean(fullPrice),
      Boolean(grant),
      Boolean(actualPrice),
      Boolean(startDate),
      Boolean(paymentDate),
    ].filter(Boolean).length
  }개 입력됨`;
  const canSelectVoucherDuration = Boolean(voucherType && voucherPriceInfos.length > 0);
  const hasVoucherPricingSelection = Boolean(voucherType && voucherDuration);

  // 기존 고객을 골라 저장값이 있을 때만 필드별 힌트와 저장값 placeholder를 보여줘요. 새 고객·자동 등록 고객·고객 미선택이면 없어요.
  const registeredSnapshot = clientId !== null && registeredBaseline?.id === clientId
    ? registeredBaseline.snapshot
    : null;
  // 제출 시 확인창과 같은 비교(diffClientSnapshots)를 쓰되, 저장값이 비어 있는 항목(채워 넣는 것)과
  // 지금 비어 있는 항목(저장값은 placeholder로 보여줘요)은 제외해요.
  const registeredFormSnapshot = registeredSnapshot
    ? buildClientDiffSnapshotFromForm({
      name,
      phone,
      birthday,
      address,
      dueDate: toRealIsoDate(dueDateInput) ?? "",
      birthDate: toRealIsoDate(birthDateInput) ?? "",
      areaId: area,
      areaTemplateName: areaTemplates.find((template) => template.areaId === area)?.templateName,
      primaryEmployeeId: employeeId,
      primaryEmployeeName: employeeName,
      secondaryEmployeeId: showEmployee2 ? employee2Id : null,
      secondaryEmployeeName: employee2Name,
      type: voucherType,
      duration: voucherDuration,
      fullPrice,
      grant,
      actualPrice,
      startDate,
      endDate,
    })
    : null;
  const registeredDiffKeys = registeredSnapshot && registeredFormSnapshot
    ? new Set(
      diffClientSnapshots(locale, registeredSnapshot, registeredFormSnapshot)
        .map((row) => row.key)
        .filter((key) => registeredSnapshot[key].value !== null && registeredFormSnapshot[key].value !== null),
    )
    : NO_REGISTERED_DIFF_KEYS;
  const registeredDiffHint = (key: ClientDiffKey): ReactNode =>
    registeredDiffKeys.has(key) ? <RegisteredValueDiffHint diffKey={key} /> : null;
  const registeredDiffDescribedBy = (key: ClientDiffKey): string | undefined =>
    registeredDiffKeys.has(key) ? getRegisteredValueDiffHintId(key) : undefined;
  // 라벨 줄 오른쪽 한 줄 자리: 오류 > 진행 상태 > 등록값 다름 힌트 순으로 하나만 보여줘요.
  // 비어 있는 필수 항목은 그 단계에서 계속하기/제출을 눌러 본 뒤에 오류로 알려줘요.
  const getRequiredMessage = (step: number, missing: boolean, text: string): FieldMessageView | null =>
    missing && attemptedSteps.includes(step) ? { tone: "error", text } : null;
  const renderFieldSlot = (
    message: FieldMessageView | null,
    id: string,
    diffKey: ClientDiffKey | null,
    dataComponent: string,
  ): ReactNode => message ? (
    <FieldMessageText id={id} tone={message.tone} data-component={dataComponent}>
      {message.text}
    </FieldMessageText>
  ) : diffKey ? registeredDiffHint(diffKey) : null;
  const getSlotDescribedBy = (
    message: FieldMessageView | null,
    id: string,
    diffKey: ClientDiffKey | null,
  ): string | undefined => message ? id : diffKey ? registeredDiffDescribedBy(diffKey) : undefined;

  const areaTemplateMessage: FieldMessageView | null = isAreaTemplatesError
    ? { tone: "error", text: AREA_TEMPLATES_ERROR_MESSAGE }
    : isAreaTemplatesEmpty
      ? { tone: "error", text: AREA_TEMPLATES_EMPTY_MESSAGE }
      : isAreaTemplatesLoading
        ? { tone: "hint", text: AREA_TEMPLATES_LOADING_MESSAGE }
        : area && !isAreaTemplateSelectionValid
          ? { tone: "error", text: AREA_TEMPLATE_SELECTION_INVALID_MESSAGE }
          : getRequiredMessage(CONTRACT_CUSTOMER_INFO_STEP_INDEX, !area, AREA_TEMPLATE_REQUIRED_MESSAGE);
  const areaTemplateSlot: ReactNode = areaTemplateMessage ? (
    <>
      <FieldMessageText
        id={AREA_TEMPLATE_MESSAGE_ID}
        tone={areaTemplateMessage.tone}
        data-component={`desktop_contracts_creation_doc-type-field_status_${isAreaTemplatesError ? "error" : isAreaTemplatesEmpty ? "empty" : isAreaTemplatesLoading ? "loading" : "message"}`}
      >
        {areaTemplateMessage.text}
      </FieldMessageText>
      {isAreaTemplatesError ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          data-component="desktop_contracts_creation_doc-type-field_status_error_retry"
          className="ml-2 h-auto shrink-0 p-0 text-[calc(12px*var(--glint-ui-scale,1))]"
          onClick={() => void refetchAreaTemplates()}
          disabled={isAreaTemplatesFetching}
        >
          {isAreaTemplatesFetching ? "재시도 중..." : "다시 시도"}
        </Button>
      ) : null}
    </>
  ) : registeredDiffHint("areaId");
  const clientNameMessage = getRequiredMessage(CONTRACT_CUSTOMER_INFO_STEP_INDEX, !name.trim(), CLIENT_NAME_REQUIRED_MESSAGE);
  const employeeMessage = getRequiredMessage(1, employeeId === null, EMPLOYEE_REQUIRED_MESSAGE);
  const employee2Message = getRequiredMessage(1, showEmployee2 && employee2Id === null, EMPLOYEE_REQUIRED_MESSAGE);
  const voucherTypeMessage = getRequiredMessage(2, !voucherType, VOUCHER_TYPE_REQUIRED_MESSAGE);
  const voucherDurationMessage = getRequiredMessage(2, !voucherDuration, VOUCHER_DURATION_REQUIRED_MESSAGE);
  const fullPriceMessage = getRequiredMessage(2, hasVoucherPricingSelection && !fullPrice, PRICE_REQUIRED_MESSAGE);
  const grantMessage = getRequiredMessage(2, hasVoucherPricingSelection && !grant, PRICE_REQUIRED_MESSAGE);
  const actualPriceMessage = getRequiredMessage(2, hasVoucherPricingSelection && !actualPrice, PRICE_REQUIRED_MESSAGE);

  // 저장값이 있으면 입력칸을 비워도 저장값이 보이도록 placeholder로 써요. 없으면 기본 placeholder를 그대로 둬요.
  const registeredPlaceholder = (
    key: ClientDiffKey,
    fallback: string,
    format: (value: string) => string = (value) => value,
  ): string => {
    const stored = registeredSnapshot?.[key].value;
    return stored ? format(stored) : fallback;
  };

  const contractFieldValues: Record<ContractInputField, string> = {
    birthday,
    dueDate: dueDateInput,
    birthDate: birthDateInput,
    startDate: startDateInput,
    endDate: endDateInput,
    paymentDate: paymentDateInput,
  };
  // 필드가 속한 단계에서 계속하기/제출을 눌러 봤으면 모든 문제 필드가 메시지를 보여줘요.
  // settled는 "필드를 떠나고 제출까지 눌렀다면"의 판정이에요. 제출 시 첫 문제 필드를 찾는 데 써요.
  const resolveContractField = (field: ContractInputField, settled = false): FieldMessageView | null => {
    const state = fields.stateOf(field, contractFieldValues[field]);
    return resolveContractFieldMessage({
      locale,
      field,
      state: settled ? { ...state, focused: false } : state,
      submitted: settled || attemptedSteps.includes(CONTRACT_INPUT_FIELD_CONFIG[field].step),
      startDate: startDateInput,
    });
  };
  const contractFieldMessages = Object.fromEntries(
    CONTRACT_INPUT_FIELDS.map((field) => [field, resolveContractField(field)]),
  ) as Record<ContractInputField, FieldMessageView | null>;
  const getContractFieldMessageId = (field: ContractInputField) => `${CONTRACT_INPUT_FIELD_CONFIG[field].inputId}-message`;
  // 라벨 줄 오른쪽 자리에는 검증 메시지(빨강/회색) > 등록값 다름 힌트(초록) 중 하나만 보여줘요.
  const getContractFieldSlotProps = (field: ContractInputField, diffKey: ClientDiffKey | null, dataComponent: string) => {
    const message = contractFieldMessages[field];
    return {
      slot: message ? (
        <FieldMessageText
          id={getContractFieldMessageId(field)}
          tone={message.tone}
          data-component={`${dataComponent}_helper`}
        >
          {message.text}
        </FieldMessageText>
      ) : diffKey ? registeredDiffHint(diffKey) : null,
      inputProps: {
        id: CONTRACT_INPUT_FIELD_CONFIG[field].inputId,
        error: message?.tone === "error",
        "aria-invalid": message?.tone === "error" ? true : undefined,
        "aria-describedby": message
          ? getContractFieldMessageId(field)
          : diffKey ? registeredDiffDescribedBy(diffKey) : undefined,
        ...fields.focusProps(field, contractFieldValues[field]),
      },
    };
  };
  const birthdaySlot = getContractFieldSlotProps("birthday", "birthday", "desktop_contracts_creation_client-birthday-input");
  const dueDateSlot = getContractFieldSlotProps("dueDate", "dueDate", "desktop_contracts_creation_client-due-date-input");
  const birthDateSlot = getContractFieldSlotProps("birthDate", "birthDate", "desktop_contracts_creation_client-birth-date-input");
  const startDateSlot = getContractFieldSlotProps("startDate", "startDate", "desktop_contracts_creation_form_start-date-input");
  const endDateSlot = getContractFieldSlotProps("endDate", "endDate", "desktop_contracts_creation_form_end-date-input");
  const paymentDateSlot = getContractFieldSlotProps("paymentDate", null, "desktop_contracts_creation_form_payment-date-input");

  // 단계의 첫 문제 필드. 연락처는 ContactInput 안에서 검증하므로 여기서는 같은 규칙으로 판정만 해요.
  const getFirstProblemTarget = (step: number): ContractFocusTarget | null => {
    if (step === CONTRACT_CUSTOMER_INFO_STEP_INDEX && hasContractPhoneProblem(phone, registeredSnapshot?.phone.value)) return "phone";
    return CONTRACT_INPUT_FIELDS_BY_STEP[step]?.find((field) => resolveContractField(field, true)?.tone === "error") ?? null;
  };

  const focusContractTarget = (target: ContractFocusTarget): boolean => {
    const element = target === "phone"
      ? document.querySelector<HTMLInputElement>('[data-component="desktop_messages_form_contact-input"] input')
      : document.getElementById(CONTRACT_INPUT_FIELD_CONFIG[target].inputId);
    if (!element) return false;
    element.scrollIntoView?.({ block: "center" });
    element.focus();
    return true;
  };

  // 해당 단계의 모든 문제 필드가 메시지를 보여주게 하고, 첫 문제 필드로 스크롤·포커스해요. 다른 단계면 그 단계로 이동한 뒤 포커스해요.
  const requestFieldFocus = (target: ContractFocusTarget, step: number) => {
    setAttemptedSteps((previous) => (previous.includes(step) ? previous : [...previous, step]));
    if (activeStep !== step) {
      pendingFocusRef.current = { target, step };
      setActiveStep(step);
      return;
    }
    if (!focusContractTarget(target)) pendingFocusRef.current = { target, step };
  };

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || activeStep !== pending.step) return;
    if (focusContractTarget(pending.target)) pendingFocusRef.current = null;
  });

  const handleStepChange = (nextStep: number) => {
    if (nextStep > activeStep) {
      const problemTarget = getFirstProblemTarget(activeStep);
      if (problemTarget) {
        requestFieldFocus(problemTarget, activeStep);
        return;
      }
      if (isStepIncomplete(activeStep)) {
        markStepAttempted(activeStep);
        return;
      }
    }
    setSubmitError(null);
    setActiveStep(nextStep);
  };

  // 비어 있는 필수 항목은 각 필드의 라벨 줄 메시지로 보여줘요. 계약 날짜 문제도 같아요.
  const isStepIncomplete = (step: number): boolean =>
    (step === 0 && !isStep1Valid)
    || (step === 1 && !isStep2Valid)
    || (step === 2 && !isStep3Valid);

  const handleWizardComplete = () => {
    const problemTarget = getFirstProblemTarget(CONTRACT_INFO_STEP_INDEX);
    if (problemTarget) {
      requestFieldFocus(problemTarget, CONTRACT_INFO_STEP_INDEX);
      return;
    }
    if (isStepIncomplete(CONTRACT_INFO_STEP_INDEX)) {
      markStepAttempted(CONTRACT_INFO_STEP_INDEX);
      return;
    }
    setActiveStep(CONTRACT_CREATION_PROCESSING_STEP_INDEX);
    void handleContractCreation();
  };

  const handleRetryContractCreation = () => {
    setActiveStep(CONTRACT_CREATION_PROCESSING_STEP_INDEX);
    void handleContractCreation();
  };

  const handleManualContractCreation = () => {
    setActiveStep(CONTRACT_CREATION_PROCESSING_STEP_INDEX);
    void handleContractCreation({ mode: "manual" });
  };

  const wizardSteps: WizardStep[] = [
    {
      label: stepLabels[0] ?? "이용자 정보",
      content: (
        <div className={PANEL_GRID_CLASS_NAME}>
          <ContractClientSelector
            value={clientId}
            onChange={handleClientSelect}
            label="산모님 성함"
            placeholder="새로 입력 또는 기존 고객 선택"
            manualValue={name}
            onManualValueChange={setName}
            disabled={Boolean(initialClient)}
            required
            labelMessage={clientNameMessage}
          />

          <ContactInput
            phone={phone}
            setPhone={setPhone}
            label={t(locale, "contract-msg.phone-label")}
            placeholder={registeredPlaceholder("phone", t(locale, "contract-msg.phone-placeholder"), formatKoreanPhoneNumber)}
            labelTrailing={registeredDiffHint("phone")}
            labelTrailingId={getRegisteredValueDiffHintId("phone")}
            required
            acceptedPhone={registeredSnapshot?.phone.value}
            submitted={attemptedSteps.includes(CONTRACT_CUSTOMER_INFO_STEP_INDEX)}
          />
          <TitleTextInputMolecule
            label={t(locale, "contract-msg.birthday-label")}
            value={birthday}
            onValueChange={(value) => {
              const nextBirthday = formatBirthdayInput(value);
              fields.onChange("birthday", birthday, nextBirthday);
              setBirthday(nextBirthday);
            }}
            placeholder={registeredPlaceholder("birthday", CONTRACT_INPUT_FIELD_CONFIG.birthday.placeholder)}
            inputMode="numeric"
            maxLength={10}
            {...birthdaySlot.inputProps}
            labelTrailing={birthdaySlot.slot}
            labelRowClassName={FIELD_MESSAGE_LABEL_ROW_CLASS_NAME}
            labelTrailingClassName={FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME}
            dataComponent="desktop_contracts_creation_client-birthday-input"
          />
          <TitleTextInputMolecule
            label={t(locale, "contract-msg.address-label")}
            value={address}
            onValueChange={setAddress}
            placeholder={registeredPlaceholder("address", t(locale, "contract-msg.address-placeholder"))}
            labelTrailing={registeredDiffHint("address")}
            labelRowClassName={FIELD_MESSAGE_LABEL_ROW_CLASS_NAME}
            labelTrailingClassName={FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME}
            aria-describedby={registeredDiffDescribedBy("address")}
            dataComponent="desktop_contracts_creation_client-address-input"
          />
          <TitleTextInputMolecule
            type="text"
            inputMode="numeric"
            maxLength={10}
            label={t(locale, "clients.form.due-date")}
            value={dueDateInput}
            onValueChange={handleDueDateInputChange}
            placeholder={registeredPlaceholder("dueDate", CONTRACT_INPUT_FIELD_CONFIG.dueDate.placeholder)}
            {...dueDateSlot.inputProps}
            labelTrailing={dueDateSlot.slot}
            labelRowClassName={FIELD_MESSAGE_LABEL_ROW_CLASS_NAME}
            labelTrailingClassName={FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME}
            dataComponent="desktop_contracts_creation_client-due-date-input"
          />
          <TitleTextInputMolecule
            type="text"
            inputMode="numeric"
            maxLength={10}
            label="출산일"
            value={birthDateInput}
            onValueChange={handleBirthDateInputChange}
            placeholder={registeredPlaceholder("birthDate", CONTRACT_INPUT_FIELD_CONFIG.birthDate.placeholder)}
            {...birthDateSlot.inputProps}
            labelTrailing={birthDateSlot.slot}
            labelRowClassName={FIELD_MESSAGE_LABEL_ROW_CLASS_NAME}
            labelTrailingClassName={FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME}
            dataComponent="desktop_contracts_creation_client-birth-date-input"
          />

          <div className="grid gap-[calc(7px*var(--glint-ui-scale,1))]" data-component="desktop_contracts_creation_doc-type-field">
            <LabelWithHint hint={areaTemplateSlot}>
              <Label className={LABEL_CLS} data-component="desktop_contracts_creation_doc-type-field_label">
                {t(locale, "contract-msg.doc-type-label")}
                <span className="text-destructive ml-1">*</span>
              </Label>
            </LabelWithHint>
            <Select
              value={area}
              onValueChange={setArea}
              disabled={isAreaTemplateSelectDisabled}
              data-component="desktop_contracts_creation_doc-type-field_select"
            >
              <SelectTrigger
                aria-label={t(locale, "contract-msg.doc-type-label")}
                aria-describedby={areaTemplateMessage ? AREA_TEMPLATE_MESSAGE_ID : registeredDiffDescribedBy("areaId")}
                aria-invalid={areaTemplateMessage?.tone === "error" ? true : undefined}
                className="w-full"
                data-component="desktop_contracts_creation_doc-type-field_select_trigger"
              >
                <SelectValue
                  placeholder={registeredPlaceholder(
                    "areaId",
                    t(locale, "contract-msg.doc-type-label"),
                    (areaId) => getAreaTemplateDisplayLabel(
                      areaId,
                      areaTemplates.find((template) => template.areaId === areaId)?.templateName,
                    ),
                  )}
                />
              </SelectTrigger>
              <SelectContent data-component="desktop_contracts_creation_doc-type-field_select_dropdown">
                {areaTemplates.map((template) => (
                  <SelectItem
                    key={template.areaId}
                    value={template.areaId}
                    data-component="desktop_contracts_creation_doc-type-field_select_dropdown_option"
                  >
                    {getAreaTemplateDisplayLabel(template.areaId, template.templateName)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {name && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {name}
            </span>
          )}
          {phone && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {phone}
            </span>
          )}
          {area && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {getAreaTemplateDisplayLabel(
                area,
                areaTemplates.find((template) => template.areaId === area)?.templateName,
              )}
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[1] ?? "제공인력 정보",
      content: (
        <div className="grid gap-[calc(18px*var(--glint-ui-scale,1))]">
          <div className={PANEL_GRID_CLASS_NAME}>
            <ContractEmployeeSelector
              value={employeeId}
              onChange={handleEmployeeSelect}
              label={t(locale, "contract-msg.employee-select-label")}
              required
              excludeIds={employee2Id !== null ? [employee2Id] : []}
              placeholder={registeredSnapshot?.primaryEmployeeId.display ?? undefined}
              labelTrailing={registeredDiffHint("primaryEmployeeId")}
              describedBy={registeredDiffDescribedBy("primaryEmployeeId")}
              error={employeeMessage !== null}
              helperText={employeeMessage?.text}
            />
            <ContactInput
              phone={employeePhone}
              setPhone={setEmployeePhone}
              label={t(locale, "contract-msg.employee-phone-label")}
              placeholder={t(locale, "contract-msg.employee-phone-placeholder")}
              disabled
            />
          </div>

          <Separator className="my-1" />
          <div className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))]">
            <Checkbox id="add-employee2" checked={showEmployee2} onCheckedChange={handleToggleShowEmployee2} />
            <Label htmlFor="add-employee2" className="cursor-pointer">
              {t(locale, "contract-msg.add-employee2-toggle")}
            </Label>
          </div>

          {showEmployee2 && (
            <div className={PANEL_GRID_CLASS_NAME}>
              <ContractEmployeeSelector
                value={employee2Id}
                onChange={handleEmployee2Select}
                label={t(locale, "contract-msg.employee2-select-label")}
                excludeIds={employeeId !== null ? [employeeId] : []}
                placeholder={registeredSnapshot?.secondaryEmployeeId.display ?? undefined}
                labelTrailing={registeredDiffHint("secondaryEmployeeId")}
                describedBy={registeredDiffDescribedBy("secondaryEmployeeId")}
                error={employee2Message !== null}
                helperText={employee2Message?.text}
              />
              <ContactInput
                phone={employee2Phone}
                setPhone={setEmployee2Phone}
                label={t(locale, "contract-msg.employee2-phone-label")}
                placeholder={t(locale, "contract-msg.employee-phone-placeholder")}
                disabled
              />
            </div>
          )}
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {(employeeName || employeeId !== null) && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {employeeName || `ID ${employeeId}`}
            </span>
          )}
          {showEmployee2 && (employee2Name || employee2Id !== null) && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {employee2Name || `ID ${employee2Id}`}
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[2] ?? "바우처 정보",
      content: (
        <div className="grid gap-[calc(18px*var(--glint-ui-scale,1))]">
          <div className={PANEL_THREE_COLUMN_GRID_CLASS_NAME}>
            <div className="space-y-2 flex-1 min-w-0">
              <Label className={LABEL_CLS}>{t(locale, "price-info-msg.voucher-year-label")}</Label>
              <FormNativeSelect
                className={SELECT_CLS}
                value={String(voucherYear)}
                onValueChange={(value) => handleVoucherYearChange(Number(value))}
                disabled={isVoucherYearsLoading}
                options={voucherYears.map((year) => ({ value: String(year), label: `${year}년` }))}
              />
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <LabelWithHint hint={renderFieldSlot(voucherTypeMessage, "contract-creation-voucher-type-message", "type", "desktop_contracts_creation_voucher-type-field_message")}>
                <Label className={LABEL_CLS}>{t(locale, "price-info-msg.voucher-type-label")}</Label>
              </LabelWithHint>
              <div className="relative">
                <FormNativeSelect
                  className={SELECT_CLS}
                  value={voucherType}
                  onValueChange={handleVoucherTypeChange}
                  hideIcon={isVoucherPriceInfosLoading}
                  aria-describedby={getSlotDescribedBy(voucherTypeMessage, "contract-creation-voucher-type-message", "type")}
                  aria-invalid={voucherTypeMessage ? true : undefined}
                  placeholder={registeredPlaceholder("type", t(locale, "price-info-msg.voucher-type-label"), getVoucherTypeLabel)}
                  options={Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => ({
                    label: groupName,
                    options: Object.entries(types).map(([typeValue, typeData]) => ({
                      value: typeValue,
                      label: typeData.label,
                    })),
                  }))}
                />
                {isVoucherPriceInfosLoading && (
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                    <Spinner className="h-4 w-4 text-primary" />
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <LabelWithHint hint={renderFieldSlot(voucherDurationMessage, "contract-creation-voucher-duration-message", "duration", "desktop_contracts_creation_voucher-duration-field_message")}>
                <Label className={LABEL_CLS}>{t(locale, "price-info-msg.duration-label")}</Label>
              </LabelWithHint>
              <FormNativeSelect
                className={SELECT_CLS}
                value={voucherDuration}
                onValueChange={handleDurationChange}
                disabled={!canSelectVoucherDuration || isVoucherPriceInfosLoading}
                aria-describedby={getSlotDescribedBy(voucherDurationMessage, "contract-creation-voucher-duration-message", "duration")}
                aria-invalid={voucherDurationMessage ? true : undefined}
                placeholder={registeredPlaceholder("duration", t(locale, "price-info-msg.duration-label"), (duration) => `${duration}일`)}
                options={voucherPriceInfos.map((v) => ({
                  value: String(v.duration),
                  label: `${v.duration}일`,
                }))}
              />
            </div>
          </div>

          <div
            data-component="desktop_contracts_creation_price-fields"
            className={cn(PANEL_THREE_COLUMN_GRID_CLASS_NAME, "animate-v3-slide-up")}
          >
            <div className="space-y-2">
              <LabelWithHint hint={renderFieldSlot(fullPriceMessage, "contract-creation-full-price-message", "fullPrice", "desktop_contracts_creation_full-price-field_message")}>
                <Label className={LABEL_CLS}>{t(locale, "contract-msg.full-price-label")}</Label>
              </LabelWithHint>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? fullPrice : "")}
                  onChange={(e) => setFullPrice(parsePrice(e.target.value))}
                  placeholder={registeredPlaceholder("fullPrice", "0", formatPrice)}
                  aria-describedby={getSlotDescribedBy(fullPriceMessage, "contract-creation-full-price-message", "fullPrice")}
                  aria-invalid={fullPriceMessage ? true : undefined}
                  disabled={!hasVoucherPricingSelection}
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div className="space-y-2">
              <LabelWithHint hint={renderFieldSlot(grantMessage, "contract-creation-grant-message", "grant", "desktop_contracts_creation_grant-field_message")}>
                <Label className={LABEL_CLS}>{t(locale, "contract-msg.grant-label")}</Label>
              </LabelWithHint>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? grant : "")}
                  onChange={(e) => setGrant(parsePrice(e.target.value))}
                  placeholder={registeredPlaceholder("grant", "0", formatPrice)}
                  aria-describedby={getSlotDescribedBy(grantMessage, "contract-creation-grant-message", "grant")}
                  aria-invalid={grantMessage ? true : undefined}
                  disabled={!hasVoucherPricingSelection}
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
            <div className="space-y-2">
              <LabelWithHint hint={renderFieldSlot(actualPriceMessage, "contract-creation-actual-price-message", "actualPrice", "desktop_contracts_creation_actual-price-field_message")}>
                <Label className={LABEL_CLS}>{t(locale, "contract-msg.actual-price-label")}</Label>
              </LabelWithHint>
              <div className="relative">
                <Input
                  variant="v3"
                  value={formatPrice(hasVoucherPricingSelection ? actualPrice : "")}
                  onChange={(e) => setActualPrice(parsePrice(e.target.value))}
                  placeholder={registeredPlaceholder("actualPrice", "0", formatPrice)}
                  aria-describedby={getSlotDescribedBy(actualPriceMessage, "contract-creation-actual-price-message", "actualPrice")}
                  aria-invalid={actualPriceMessage ? true : undefined}
                  disabled={!hasVoucherPricingSelection}
                  className={`${INPUT_CLS} pr-12`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {voucherType && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {voucherType}
            </span>
          )}
          {voucherDuration && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {voucherDuration}일
            </span>
          )}
          {hasVoucherPricingSelection && actualPrice && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {formatPrice(actualPrice)}원
            </span>
          )}
        </div>
      ),
    },
    {
      label: stepLabels[3] ?? "계약 정보",
      content: (
        <div className="grid gap-[calc(16px*var(--glint-ui-scale,1))]">
          <div className={PANEL_THREE_COLUMN_GRID_CLASS_NAME}>
            <div className="space-y-2 flex-1 min-w-0">
              <LabelWithHint hint={startDateSlot.slot}>
                <Label
                  htmlFor="contract-creation-start-date"
                  className={LABEL_CLS}
                >
                  {t(locale, "contract-msg.start-date-label")}
                </Label>
              </LabelWithHint>
              <Input
                {...startDateSlot.inputProps}
                variant="v3"
                type="text"
                inputMode="numeric"
                maxLength={10}
                placeholder={registeredPlaceholder("startDate", CONTRACT_INPUT_FIELD_CONFIG.startDate.placeholder)}
                value={startDateInput}
                required
                onChange={(e) => {
                  const formatted = formatIsoDateInput(e.target.value);
                  fields.onChange("startDate", startDateInput, formatted);
                  setStartDateInput(formatted);
                  if (formatted.length === 10) setStartDate(formatted);
                  else if (formatted.length === 0) setStartDate("");
                }}
                data-component="desktop_contracts_creation_form_start-date-input"
                className={INPUT_CLS}
              />
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              <LabelWithHint hint={endDateSlot.slot}>
                <Label
                  htmlFor="contract-creation-end-date"
                  className={LABEL_CLS}
                >
                  {t(locale, "contract-msg.end-date-label")}
                </Label>
              </LabelWithHint>
              <Input
                {...endDateSlot.inputProps}
                variant="v3"
                type="text"
                inputMode="numeric"
                maxLength={10}
                placeholder={registeredPlaceholder("endDate", CONTRACT_INPUT_FIELD_CONFIG.endDate.placeholder)}
                value={endDateInput}
                onChange={(e) => {
                  const formatted = formatIsoDateInput(e.target.value);
                  fields.onChange("endDate", endDateInput, formatted);
                  setEndDateInput(formatted);
                  if (formatted.length === 10) setEndDate(formatted);
                  else if (formatted.length === 0) setEndDate("");
                }}
                data-component="desktop_contracts_creation_form_end-date-input"
                className={INPUT_CLS}
              />
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              <LabelWithHint hint={paymentDateSlot.slot}>
                <Label
                  htmlFor="contract-creation-payment-date"
                  className={LABEL_CLS}
                >
                  {t(locale, "contract-msg.payment-date-label")}
                </Label>
              </LabelWithHint>
              <Input
                {...paymentDateSlot.inputProps}
                variant="v3"
                type="text"
                inputMode="numeric"
                maxLength={10}
                placeholder={CONTRACT_INPUT_FIELD_CONFIG.paymentDate.placeholder}
                value={paymentDateInput}
                required
                onChange={(e) => {
                  const formatted = formatIsoDateInput(e.target.value);
                  fields.onChange("paymentDate", paymentDateInput, formatted);
                  setPaymentDateInput(formatted);
                  if (formatted.length === 10) setPaymentDate(formatted);
                  else if (formatted.length === 0) setPaymentDate("");
                }}
                data-component="desktop_contracts_creation_form_payment-date-input"
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {startDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {startDate} ~ {endDate || "(직원 입력 예정)"}
            </span>
          )}
          {paymentDate && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              결제일 {paymentDate}
            </span>
          )}
        </div>
      ),
    },
    {
      label: "전자문서 생성",
      content: (
        <div className="flex h-full w-full items-stretch justify-center py-2">
          <HeadlessProgressStepper
            steps={CONTRACT_CREATION_PROGRESS_STEPS}
            progress={creationProgress}
            ariaLabel="전자계약서 생성 진행 상태"
            dataComponentPrefix="contract-creation-processing"
            testIdPrefix="contract-creation-progress"
            errorHint={CONTRACT_CREATION_MANUAL_HELP}
            spinnerClassName="contract-creation-processing-spinner"
            className="h-full w-full max-w-[22rem] [&>li:not(:last-child)]:flex-1"
          />
        </div>
      ),
    },
  ];

  const content = (
    <SteppedWizardPanelContent
      dataComponent="desktop_contracts_creation_form"
      className={contentClassName}
      stepContentClassName={cn(stepContentClassName, isProcessingStep && "flex min-h-0 flex-1")}
      feedback={
        <>
          {(submitError || eformsignError) && (
            <Alert variant="destructive" data-component="desktop_messages_sections_contract-form-error">
              <AlertDescription>{submitError || eformsignError}</AlertDescription>
            </Alert>
          )}

          {unverifiedDispatchNotice && (
            <Alert
              variant="destructive"
              data-component="desktop_contracts_creation_unverified-dispatch-notice"
              data-testid="contract-creation-unverified-notice"
            >
              <AlertDescription>{unverifiedDispatchNotice}</AlertDescription>
            </Alert>
          )}

          {isEformsignLoading && (
            <Alert data-component="desktop_messages_sections_contract-form-loading">
              <AlertDescription>eformsign SDK를 로드하는 중입니다...</AlertDescription>
            </Alert>
          )}
        </>
      }
    >
      {wizardSteps[activeStep]?.content}
    </SteppedWizardPanelContent>
  );

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))]">
      <span className={DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME}>{requiredFieldProgressText}</span>
      <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
        {activeStep === 0 && !hasProcessingSuccess ? (
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={handleCancel}
            disabled={hasCreationSession && !hasProcessingFailure}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            취소
          </Button>
        ) : (
          null
        )}
        {activeStep > 0 && !isProcessingStep && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="contract-creation-back"
            onClick={() => handleStepChange(activeStep - 1)}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            이전
          </Button>
        )}
        {activeStep < CONTRACT_INFO_STEP_INDEX ? (
          <Button
            type="button"
            size="sm"
            data-testid="contract-creation-next"
            onClick={() => handleStepChange(activeStep + 1)}
            disabled={!isCurrentStepValid}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            다음
          </Button>
        ) : activeStep === CONTRACT_INFO_STEP_INDEX ? (
          <Button
            type="button"
            size="sm"
            data-testid="contract-creation-submit"
            onClick={handleWizardComplete}
            disabled={!isStep1Valid || !isStep2Valid || !isStep3Valid || isSubmitting}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            {isSubmitting ? "처리 중..." : t(locale, "contract-msg.contract-creation")}
          </Button>
        ) : hasProcessingSuccess ? (
          <Button
            type="button"
            size="sm"
            data-testid="contract-creation-new-send"
            data-component="desktop_contracts_creation_new-send"
            onClick={handleStartNewContractCreation}
            className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
          >
            새 전자문서 발송
          </Button>
        ) : hasProcessingFailure ? (
          <>
            {allowIframeFallback ? <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="contract-creation-manual"
              onClick={handleManualContractCreation}
              disabled={isSubmitting}
              className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
            >
              수동 입력
            </Button> : null}
            <Button
              type="button"
              size="sm"
              data-testid="contract-creation-retry"
              onClick={handleRetryContractCreation}
              disabled={isSubmitting}
              className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
            >
              {isSubmitting ? "재시도 중..." : "재시도"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {renderLayout ? renderLayout({ content, footer, footerClassName }) : (
        <>
          {content}
          <footer
            data-component="desktop_contracts_creation_form_footer"
            data-slot="detail-panel-footer"
            className={cn(DETAIL_PANEL_FOOTER_CLASS_NAME, footerClassName)}
          >
            {footer}
          </footer>
        </>
      )}

      <Dialog open={isDialogOpen} onOpenChange={(open: boolean) => !open && handleDialogClose()}>
        <DialogContent
          data-component="desktop_messages_sections_contract-form-dialog"
          // Mobile: full-screen. Desktop (lg+): keep the manual eformsign canvas near A4 portrait.
          className="max-w-full w-screen h-screen p-0 gap-0 flex flex-col lg:w-[820px] lg:max-w-[95vw] lg:h-[1102px] lg:max-h-[95vh] lg:rounded-lg"
        >
          <DialogHeader className="px-4 py-2 flex flex-row items-center justify-between border-b shrink-0">
            <DialogTitle>계약서 작성</DialogTitle>
            <DialogDescription className="sr-only">
              전자문서 작성 화면과 생성 진행 상태를 표시합니다.
            </DialogDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="계약서 작성 닫기"
              onClick={handleDialogClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <iframe id="eformsign_iframe" className="w-full h-full border-none" title="eformsign Document" />
          </div>
        </DialogContent>
      </Dialog>

      <NotificationOneButtonModal
        open={isCreationSuccessOpen}
        onOpenChange={(open) => {
          if (!open) handleCreationSuccessAcknowledged();
        }}
        dataComponent="desktop_contracts_creation_success-notification"
        title="계약서가 성공적으로 생성되었습니다."
        description="전자문서 생성과 전송이 완료되었습니다."
        onAcknowledge={handleCreationSuccessAcknowledged}
      />
      <Dialog
        open={clientDiffPrompt !== null}
        onOpenChange={(open: boolean) => {
          if (!open) resolveClientDiffDecision("cancel");
        }}
      >
        <DialogContent
          data-component="desktop_contracts_creation_client-diff-dialog"
          showCloseButton
          className="sm:max-w-[420px]"
        >
          <DialogHeader data-component="desktop_contracts_creation_client-diff-dialog_header">
            <DialogTitle data-component="desktop_contracts_creation_client-diff-dialog_title">
              고객 정보와 다른 내용이 있어요
            </DialogTitle>
            <DialogDescription data-component="desktop_contracts_creation_client-diff-dialog_description">
              계약서에 입력한 내용이 저장된 고객 정보와 달라요. 고객 정보도 함께 수정할까요?
            </DialogDescription>
          </DialogHeader>
          <ul
            data-component="desktop_contracts_creation_client-diff-dialog_list"
            className="max-h-[calc(50vh)] space-y-2 overflow-y-auto text-sm"
          >
            {clientDiffPrompt?.rows.map((row) => (
              <li
                key={row.key}
                data-component="desktop_contracts_creation_client-diff-dialog_row"
                className="grid grid-cols-[calc(96px*var(--glint-ui-scale,1))_1fr] gap-2"
              >
                <span
                  data-component="desktop_contracts_creation_client-diff-dialog_row_label"
                  className="font-semibold text-v3-text-muted"
                >
                  {row.label}
                </span>
                <span
                  data-component="desktop_contracts_creation_client-diff-dialog_row_value"
                  className="break-words"
                >
                  {row.oldDisplay} → {row.newDisplay}
                </span>
              </li>
            ))}
          </ul>
          {clientDiffPrompt?.showPeriodLockedNote ? (
            <p
              data-component="desktop_contracts_creation_client-diff-dialog_period-locked-note"
              className="text-sm text-v3-text-muted"
            >
              {CLIENT_DIFF_PERIOD_LOCKED_NOTE}
            </p>
          ) : null}
          <DialogFooter data-component="desktop_contracts_creation_client-diff-dialog_footer">
            <Button
              type="button"
              variant="neutral"
              data-component="desktop_contracts_creation_client-diff-dialog_contract-only"
              onClick={() => resolveClientDiffDecision("contract-only")}
            >
              계약서에만 반영
            </Button>
            <Button
              type="button"
              data-component="desktop_contracts_creation_client-diff-dialog_update-client"
              onClick={() => resolveClientDiffDecision("update-client")}
            >
              고객 정보도 수정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TwoButtonModal
        open={confirmationMessage !== null}
        onOpenChange={(open) => {
          if (!open) resolveConfirmation(false);
        }}
        dataComponent="desktop_contracts_creation_confirmation"
        title="계약서 생성 확인"
        description={confirmationMessage ?? ""}
        isDescriptionVisuallyHidden={false}
        approvalLabel="확인"
        onApprove={() => resolveConfirmation(true)}
      />
    </>
  );
};
