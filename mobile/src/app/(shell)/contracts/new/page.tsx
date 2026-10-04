"use client";
import { isValidBirthdayIsoDate, normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { isRealIsoDate, resolveFieldMessage } from "@babyjamjam/shared/utils/field-validation-message";
import {
  normalizeApiError,
  type ProblemOutcome,
} from "@babyjamjam/shared";


import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import dayjs from "dayjs";
import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";

import { useFormStore } from "@/stores/form-store";
import { useEformsign } from "@/hooks/useEformsign";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { toast } from "@/hooks/use-toast";
import { openAuthenticatedEventSource } from "@/lib/api/authenticated-fetch";
import { useVoucherYears, useVoucherPriceInfos, useAreaTemplates, useAllVoucherPrices } from "@/hooks";
import { useAllClients, useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useEmployees, type Employee } from "@/hooks/useEmployees";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { eformsignApi } from "@/services/api";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import type { Client } from "@/lib/client/types";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";

import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { isStrictIsoDate, normalizeIsoDate, toIsoDate, todayIsoDate } from "@/lib/contracts/date-input";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { CalendarLoadNotice } from "@/components/app/holidays/calendar-load-notice";
import { buildInitialSignRequestDocRecord } from "@/lib/eformsign/document-record";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "@/lib/phone";
import {
  CONTRACT_CREATION_PROGRESS_STEPS,
  INITIAL_HEADLESS_PROGRESS,
  createHeadlessProgressId,
  getSafeHeadlessFailureMessage,
  isHeadlessProgressStepKey,
  resolveFailedHeadlessProgress,
  resolveNextHeadlessProgress,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
} from "@/lib/eformsign/headless-progress";
import { HeadlessProgressModal } from "@/components/app/eformsign/HeadlessProgressModal";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { ContractFieldLabelMessage, type FieldLabelMessage } from "@/components/app/contracts/contract-field-label-message";
import {
  ContractFormField,
  type ContractFormFieldMessage,
} from "@/components/app/contracts/contract-form-field";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildContractSubmissionAlert,
  buildHeadlessProviderFailureAlert,
  canUseContractIframeFallback,
  CONTRACT_OUTCOME_COPY,
  focusContractValidationErrors,
  isHeadlessSuccessResponse,
  isRecord,
  isSafeClientId,
  isValidIframeSuccessResponse,
  type ContractSubmissionAlert,
} from "./page.helpers";
import {
  CLIENT_DIFF_PERIOD_LOCKED_NOTE,
  CLIENT_PERIOD_DIFF_KEYS,
  REGISTERED_VALUE_DIFF_HINT,
  buildClientDiffSnapshotFromClient,
  buildClientDiffSnapshotFromForm,
  diffClientSnapshots,
  getRegisteredDiffKeys,
  serializeClientDiffSnapshot,
  type ClientDiffDecision,
  type ClientDiffKey,
  type ClientDiffPrompt,
  type ClientDiffSnapshot,
  type LoadedClientBaseline,
} from "./client-diff";
import {
  BIRTHDAY_PLACEHOLDER,
  END_DATE_AUTO_CALC_INFO,
  END_DATE_PLACEHOLDER,
  PAYMENT_DATE_PLACEHOLDER,
  PHONE_PLACEHOLDER,
  START_DATE_PLACEHOLDER,
  focusContractField,
  getBirthdayMessageText,
  getBirthdayProblem,
  getContractDateProblem,
  getContractDateValues,
  getFieldMessageText,
  getPhoneProblem,
  resolveBirthdayMessage,
  useFieldInteractions,
  type ContractFieldKey,
} from "./field-messages";
import { readHeadlessOutcome } from "../contract-operation-guard";
import styles from "./page.module.css";

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
  startYear: string; startMonth: string; startDay: string; startDate: string;
  endYear: string; endMonth: string; endDay: string; endDate: string;
  paymentYear: string; paymentMonth: string; paymentDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

const WIZARD_STEPS = [
  { title: "이용자 정보", desc: "기존 고객을 검색하거나 정보를 입력해주세요." },
  { title: "제공인력 정보", desc: "계약에 배정될 제공인력을 선택해주세요." },
  { title: "바우처 정보", desc: "바우처 유형과 기간, 요금을 확인해주세요." },
  { title: "계약 정보", desc: "서비스 기간과 본인부담금 수령 날짜를 입력해주세요." },
] as const;
const SUCCESS_REDIRECT_DELAY_MS = 3_000;
const CONTRACT_START_DATE_INPUT_ID = "contracts-new-review-start-date";
const CONTRACT_END_DATE_INPUT_ID = "contracts-new-review-end-date";
const CONTRACT_PAYMENT_DATE_INPUT_ID = "contracts-new-review-payment-date";
const CONTRACT_DATE_ERROR_TEST_ID = "contract-creation-date-range-error";
const PHONE_INPUT_SELECTOR = "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input\"]";
const BIRTHDAY_INPUT_SELECTOR = "[data-component=\"mobile_contracts-new_screen_root_page_root_form-scroll_card_birthday-input\"]";
const CONTRACT_DATE_INPUT_SELECTORS = {
  startDate: `#${CONTRACT_START_DATE_INPUT_ID}`,
  endDate: `#${CONTRACT_END_DATE_INPUT_ID}`,
  paymentDate: `#${CONTRACT_PAYMENT_DATE_INPUT_ID}`,
} as const;
const NO_REGISTERED_DIFF_KEYS: ReadonlySet<ClientDiffKey> = new Set();
const CLIENT_PERIOD_DTO_KEYS: ReadonlySet<string> = new Set(["duration", "startDate", "endDate"]);

function getRegisteredDiffHintId(key: ClientDiffKey): string {
  return `contracts-new-registered-diff-hint-${key}`;
}
const AREA_TEMPLATE_DISPLAY_LABELS: Record<string, string> = {
  Namdonggu: "남동구",
  Seogu: "서구",
};

function getAreaTemplateDisplayLabel(areaId: string, templateName?: string | null): string {
  const mappedLabel = AREA_TEMPLATE_DISPLAY_LABELS[areaId];
  if (mappedLabel) return mappedLabel;

  return templateName?.replace(/\s*계약서.*$/, "").trim() || areaId;
}

const formatPhoneNumber = formatKoreanPhoneNumber;

// 저장된 계약서 유형이 불러온 템플릿 목록에 있을 때만 값으로 돌려줘요. 없으면 빈 값이에요.
function resolveStoredAreaId(
  storedAreaId: string | null | undefined,
  areaTemplates: ReadonlyArray<{ areaId: string }> | undefined,
): string {
  const trimmed = storedAreaId?.trim() ?? "";
  if (!trimmed) return "";
  return areaTemplates?.some((template) => template.areaId === trimmed) ? trimmed : "";
}

type ClientWithBirthdayAliases = Client & Partial<Record<
  "birthDate" | "birth_date" | "dateOfBirth" | "customerBirthDate" | "customerDOB",
  string | null
>>;

const clientBirthdayValue = (client: ClientWithBirthdayAliases | null | undefined): string | null | undefined =>
  client?.birthday ??
  client?.birthDate ??
  client?.birth_date ??
  client?.dateOfBirth ??
  client?.customerBirthDate ??
  client?.customerDOB;

const normalizeBirthdayInput = (value: string | null | undefined): string =>
  normalizeBirthdayIsoDate(value) ?? value ?? "";

/**
 * Calendar years the form's own dates need on top of the default window: the
 * year of each complete date, plus the year after the start date because a
 * period that starts in December ends in January.
 */
const calendarYearsForDates = (startDate: string, endDate: string): number[] => {
  const years = new Set<number>();
  const start = normalizeIsoDate(startDate);
  const end = normalizeIsoDate(endDate);
  if (isStrictIsoDate(start)) {
    years.add(Number(start.slice(0, 4)));
    years.add(Number(start.slice(0, 4)) + 1);
  }
  if (isStrictIsoDate(end)) years.add(Number(end.slice(0, 4)));
  return [...years];
};

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

const normalizeAmount = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\D/g, "");
};

const normalizeClientIdentityName = (value: string | null | undefined): string =>
  (value ?? "").trim().replace(/\s+/g, " ");

const normalizeClientIdentityPhone = (value: string | null | undefined): string =>
  normalizeKoreanPhoneDigits(value);

export default function ContractCreationPage() {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();
  const queryClient = useQueryClient();

  const createClientMutation = useCreateClient();
  const updateClientMutation = useUpdateClient();
  const { isLoaded: isEformsignLoaded, openDocument } = useEformsign();
  const {
    data: allClients,
    isError: isClientsError,
    error: clientsError,
    refetch: refetchClients,
    isFetching: isClientsFetching,
  } = useAllClients();
  const clientsNormalizedError = clientsError
    ? normalizeApiError(clientsError, { operation: "read", locale: "ko-KR" })
    : null;
  const showClientsError = isClientsError && Boolean(clientsNormalizedError) && !clientsNormalizedError?.suppress;
  const clientsDataUnavailable = showClientsError && allClients === undefined;
  const { data: voucherYears } = useVoucherYears();
  const { data: areaTemplates } = useAreaTemplates();
  const { data: employees } = useEmployees();

  const {
    clientId, isManualEntry, name, phone, birthday, address, dueDate, area,
    employeeId, employeeName, employeePhone,
    showEmployee2, employee2Id, employee2Name, employee2Phone,
    voucherType, voucherDuration, voucherYear,
    fullPrice, grant, actualPrice,
    startDate, endDate, paymentDate, isContractReissue,
    preservePrefilledPrices,
    setClientId, setIsManualEntry, setName, setPhone, setBirthday, setAddress, setDueDate, setArea,
    setIsEmployeeManualEntry, setEmployeeSelection,
    setShowEmployee2, setIsEmployee2ManualEntry, setEmployee2Selection,
    setVoucherType, setVoucherDuration, setVoucherYear,
    setFullPrice, setGrant, setActualPrice,
    setStartDate, setEndDate, setPaymentDate,
    setPreservePrefilledPrices,
    supersede, clearSupersede,
  } = useFormStore();

  // Re-issue: the replaced unsigned contract is cancelled only after the new one was
  // sent, and only when the contract just sent belongs to the same client. The target
  // is taken out of the store on entry so it never outlives this visit.
  const [supersedeTarget, setSupersedeTarget] = useState(supersede);
  useEffect(() => {
    clearSupersede();
  }, [clearSupersede]);
  useEffect(() => {
    if (supersedeTarget && clientId !== supersedeTarget.clientId) setSupersedeTarget(null);
  }, [clientId, supersedeTarget]);
  const supersedePreviousContract = (sentClientId: number | null | undefined) => {
    if (!supersedeTarget || sentClientId !== supersedeTarget.clientId) return;
    const { documentId, clientId: supersedeClientId } = supersedeTarget;
    setSupersedeTarget(null);
    eformsignApi.supersedeDocument(documentId, supersedeClientId)
      .then(() => queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() }))
      .catch(() => {
        toast({
          variant: "destructive",
          description: "새 계약서는 보냈지만 기존 계약서를 취소하지 못했어요. 전자문서 목록에서 확인해 주세요",
        });
      });
  };

  // The branch holiday calendar. The end date is saved with the contract, so
  // its auto-calculation waits for `ready`; before then `calendar` is the built-in list.
  const calendarYears = useMemo(() => calendarYearsForDates(startDate, endDate), [endDate, startDate]);
  const {
    calendar,
    ready: calendarReady,
    error: calendarError,
    retry: retryCalendar,
  } = useBusinessDayCalendar({ extraYears: calendarYears });
  const calendarRef = useRef(calendar);
  calendarRef.current = calendar;
  const endDateCalcSkippedRef = useRef(false);
  // The auto calculation reached a year the branch calendar does not cover. The end date is
  // cleared (never left stale), a notice is shown and submitting is blocked until it is resolved.
  const [endDateUnsupported, setEndDateUnsupported] = useState(false);
  const endDateCalcInputsRef = useRef<{ startDate: string; voucherDuration: string } | null>(null);
  // The (startDate, duration) a picked client's stored end date was filled with; no recalculation while they stay the same.
  // A client prefilled from another screen arrives with its stored end date, which is kept too.
  const keptEndDateInputsRef = useRef<{ startDate: string; voucherDuration: string } | null>(
    clientId !== null && endDate && startDate && voucherDuration ? { startDate, voucherDuration } : null,
  );

  const { data: voucherPriceInfos, isLoading: isPriceLoading } =
    useVoucherPriceInfos(voucherType || "", voucherYear || 0);
  const { data: allVoucherPrices } = useAllVoucherPrices(voucherYear || undefined);

  const [activeStep, setActiveStep] = useState(0);
  const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEformsignModalOpen, setIsEformsignModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [isExistingContractConfirmOpen, setIsExistingContractConfirmOpen] = useState(false);
  const [submissionAlert, setSubmissionAlert] = useState<ContractSubmissionAlert | null>(null);
  const [submissionLock, setSubmissionLock] = useState<ContractSubmissionAlert | null>(null);
  const submissionInFlightRef = useRef(false);
  const submissionLockRef = useRef<ContractSubmissionAlert | null>(null);
  const iframeOutcomeConfirmedRef = useRef(false);
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
  // 기존 고객을 골랐고 계약서 입력값이 저장된 고객 정보와 다르면, 제출 전에 고객 정보도 수정할지 물어봐요.
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
  // 선택된 기존 고객의 저장값이에요. 고객 정보를 함께 수정하면 수정된 값으로 갱신해요.
  const loadedClientBaselineRef = useRef<LoadedClientBaseline | null>(null);
  // 위 ref와 같은 저장값을 렌더링에서 쓰기 위한 복사본이에요. 필드별 "등록된 정보와 달라요." 힌트와 placeholder가 읽어요.
  const [registeredBaseline, setRegisteredBaseline] = useState<LoadedClientBaseline | null>(null);
  // "계약서에만 반영"을 고른 입력값이에요. 같은 입력으로 다시 제출하면 다시 묻지 않아요.
  const contractOnlyChoiceRef = useRef<{ clientId: number; formKey: string } | null>(null);
  const [creationProgress, setCreationProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [progressErrorHint, setProgressErrorHint] = useState<string | null>(null);
  const progressSourceRef = useRef<EventSource | null>(null);
  const selectedClientRef = useRef<Pick<Client, "id" | "name"> | null>(null);
  const persistedClientIdRef = useRef<number | null>(null);
  const persistedClientSnapshotRef = useRef<string | null>(null);
  const retryWithPersistedClientRef = useRef(false);
  const defaultPaymentDate = useMemo(() => isContractReissue ? "" : todayIsoDate(), [isContractReissue]);
  const hasAppliedPaymentStepDefaultRef = useRef(false);

  // Local YYYY-MM-DD drafts so partial input doesn't trash the ISO store value
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");
  const paymentDateInputTouchedRef = useRef(false);
  const isContractInfoStep = activeStep === WIZARD_STEPS.length - 1;
  const normalizedPaymentDate = normalizeIsoDate(paymentDate);
  const fallbackPaymentDate = normalizedPaymentDate || defaultPaymentDate;
  const shouldUseFallbackPaymentDate =
    isContractInfoStep && paymentDateInput.length === 0 && !paymentDateInputTouchedRef.current;
  const effectivePaymentDateInput = shouldUseFallbackPaymentDate ? fallbackPaymentDate : paymentDateInput;
  // 필드 메시지는 화면 상호작용(포커스·떠남·입력 이력)과 단계별 "다음/생성" 시도 여부로 결정돼요.
  const fieldInteractions = useFieldInteractions();
  const [submittedSteps, setSubmittedSteps] = useState<ReadonlySet<number>>(() => new Set());
  const contractDateValues = getContractDateValues({
    startDateInput,
    endDateInput,
    paymentDateInput: effectivePaymentDateInput,
  });
  const effectiveStartDate = contractDateValues.startDate || startDate;
  const effectiveEndDate = contractDateValues.endDate || endDate;
  const effectivePaymentDate = shouldUseFallbackPaymentDate
    ? fallbackPaymentDate
    : contractDateValues.paymentDate || paymentDate;

  useEffect(() => {
    if (!isContractInfoStep) {
      hasAppliedPaymentStepDefaultRef.current = false;
      return;
    }

    if (hasAppliedPaymentStepDefaultRef.current) return;
    hasAppliedPaymentStepDefaultRef.current = true;
    if (!normalizedPaymentDate && defaultPaymentDate) setPaymentDate(defaultPaymentDate);
  }, [defaultPaymentDate, isContractInfoStep, normalizedPaymentDate, setPaymentDate]);
  // 저장소에는 예전 6자리(YYMMDD) 값이 들어올 수 있어 toIsoDate로 읽어요. 직접 입력한 값은 항상 YYYY-MM-DD예요.
  useEffect(() => { setStartDateInput(toIsoDate(startDate)); }, [startDate]);
  useEffect(() => { setEndDateInput(toIsoDate(endDate)); }, [endDate]);
  useEffect(() => {
    // Keep an invalid or partial visible draft intact while the canonical
    // payment date is updated by the step default or another store change.
    if (paymentDateInputTouchedRef.current) return;
    setPaymentDateInput(toIsoDate(paymentDate));
  }, [paymentDate]);
  // 이전 방문에서 남은 계약서 유형은 비워요. 고객이 정해져 있으면 아래 effect가 저장된 유형을 다시 골라줘요.
  useEffect(() => {
    setArea("");
  }, [setArea]);
  // 마지막으로 계약서 유형을 직접 고른 고객이에요(없으면 undefined). 같은 고객에게는 저장된 유형을 다시 덮어쓰지 않아요.
  const manualAreaChoiceClientRef = useRef<number | null | undefined>(undefined);
  // 고객 상세·계약서 목록의 수정 발송처럼 고객이 미리 채워져 들어오거나, 템플릿·고객 목록이 늦게 도착해도 저장된 유형을 골라줘요.
  // 사용자가 직접 고른 뒤에는 같은 고객에게 다시 덮어쓰지 않아요. 저장된 유형이 템플릿에 없으면 비워 둬요.
  useEffect(() => {
    if (clientId === null || !allClients || !areaTemplates) return;
    if (manualAreaChoiceClientRef.current === clientId) return;
    const storedClient = allClients.find((candidate) => candidate.id === clientId);
    if (!storedClient) return;
    const storedAreaId = resolveStoredAreaId(storedClient.areaId, areaTemplates);
    if (area !== storedAreaId) setArea(storedAreaId);
  }, [allClients, area, areaTemplates, clientId, setArea]);
  useEffect(() => {
    if (clientId !== null && name.trim()) {
      selectedClientRef.current = { id: clientId, name };
    } else if (clientId === null) {
      selectedClientRef.current = null;
    }
  }, [clientId, name]);

  const handleDateInputChange = (
    setLocal: (v: string) => void,
    setStore: (v: string) => void,
    raw: string,
    isPaymentDate = false,
  ) => {
    if (isPaymentDate) paymentDateInputTouchedRef.current = true;
    const v = formatIsoDateInput(raw);
    setLocal(v);
    if (isRealIsoDate(v)) {
      setStore(v);
    } else if (v.length === 0) {
      setStore("");
    }
  };

  const availableDurations = useMemo(() => {
    if (!voucherPriceInfos) return [];
    const list = [...new Set(voucherPriceInfos.map((i) => String(i.duration)))];
    return list.sort((a, b) => Number(a) - Number(b));
  }, [voucherPriceInfos]);

  const selectedPriceInfo = useMemo(() => {
    if (!voucherPriceInfos || !voucherDuration) return null;
    return voucherPriceInfos.find((i) => String(i.duration) === voucherDuration) ?? null;
  }, [voucherPriceInfos, voucherDuration]);

  const selectableVoucherTypes = useMemo(() => {
    const values = Object.values(voucherOptions.voucherOptions).flatMap((types) => Object.keys(types));
    return new Set(values);
  }, []);
  const hasSelectableVoucherType = voucherType ? selectableVoucherTypes.has(voucherType) : false;

  const storedClientByIdentity = useMemo(() => {
    const targetName = normalizeClientIdentityName(name);
    const targetPhone = normalizeClientIdentityPhone(phone);
    if (!targetName || !targetPhone || !allClients) return null;

    return allClients.find((client) =>
      normalizeClientIdentityName(client.name) === targetName &&
      normalizeClientIdentityPhone(client.phone) === targetPhone,
    ) ?? null;
  }, [allClients, name, phone]);

  const storedClientByPhone = useMemo(() => {
    const targetPhone = normalizeClientIdentityPhone(phone);
    if (!targetPhone || !allClients) return null;

    return allClients.find((client) =>
      normalizeClientIdentityPhone(client.phone) === targetPhone,
    ) ?? null;
  }, [allClients, phone]);

  const clientWithExistingContract = useMemo(() => {
    if (clientId !== null) {
      return allClients?.find((client) => client.id === clientId) ?? null;
    }

    return storedClientByIdentity ?? storedClientByPhone ?? null;
  }, [allClients, clientId, storedClientByIdentity, storedClientByPhone]);
  const hasExistingContractRecord = Boolean(clientWithExistingContract?.eDocId);

  useEffect(() => {
    if (!allClients) return;

    const targetName = normalizeClientIdentityName(name);
    const currentPhoneDigits = normalizeClientIdentityPhone(phone);
    if (!currentPhoneDigits) return;

    const selectedClient = clientId !== null
      ? allClients.find((client) => client.id === clientId)
      : allClients.find((client) => (
        targetName &&
        normalizeClientIdentityName(client.name) === targetName &&
        (
          normalizeClientIdentityPhone(client.phone) === currentPhoneDigits ||
          (
            normalizeClientIdentityPhone(client.phone).length === currentPhoneDigits.length + 1 &&
            normalizeClientIdentityPhone(client.phone).startsWith(currentPhoneDigits)
          )
        )
      ));

    if (!selectedClient) return;

    if (selectedClient.phone) {
      const selectedPhoneDigits = normalizeClientIdentityPhone(selectedClient.phone);
      const selectedPhone = formatPhoneNumber(selectedClient.phone);

      if (
        selectedPhone &&
        selectedPhone !== phone &&
        currentPhoneDigits.length > 0 &&
        selectedPhoneDigits.length === currentPhoneDigits.length + 1 &&
        selectedPhoneDigits.startsWith(currentPhoneDigits)
      ) {
        setPhone(selectedPhone);
      }
    }

    const selectedBirthday = normalizeBirthdayInput(clientBirthdayValue(selectedClient));
    if (!birthday && selectedBirthday) {
      setBirthday(selectedBirthday);
    }
  }, [allClients, birthday, clientId, name, phone, setBirthday, setPhone]);

  useEffect(() => {
    if (!preservePrefilledPrices) return;
    if (fullPrice || grant || actualPrice) setPricesManuallyEdited(true);
    setPreservePrefilledPrices(false);
  }, [
    actualPrice,
    fullPrice,
    grant,
    preservePrefilledPrices,
    setPreservePrefilledPrices,
  ]);

  useEffect(() => {
    if (hasSelectableVoucherType || !fullPrice || !grant || !actualPrice) return;

    const normalizedFullPrice = normalizeAmount(fullPrice);
    const normalizedGrant = normalizeAmount(grant);
    const normalizedActualPrice = normalizeAmount(actualPrice);
    if (!normalizedFullPrice || !normalizedGrant || !normalizedActualPrice) return;

    const matches = (allVoucherPrices ?? []).filter((priceInfo) =>
      normalizeAmount(priceInfo.fullPrice) === normalizedFullPrice &&
      normalizeAmount(priceInfo.grant) === normalizedGrant &&
      normalizeAmount(priceInfo.actualPrice) === normalizedActualPrice,
    );
    const matchedPrice =
      matches.find((priceInfo) => String(priceInfo.duration) === voucherDuration) ??
      matches[0];
    const matchedType = matchedPrice?.type?.trim();

    if (!matchedPrice || !matchedType) return;

    setVoucherType(matchedType);
    setVoucherDuration(String(matchedPrice.duration));
    setPricesManuallyEdited(true);
  }, [
    actualPrice,
    allVoucherPrices,
    fullPrice,
    grant,
    setVoucherDuration,
    setVoucherType,
    hasSelectableVoucherType,
    voucherDuration,
  ]);

  useEffect(() => {
    if (!voucherType || voucherDuration || !voucherPriceInfos || voucherPriceInfos.length !== 1) return;
    const onlyDuration = String(voucherPriceInfos[0]?.duration ?? "");
    if (onlyDuration) setVoucherDuration(onlyDuration);
  }, [setVoucherDuration, voucherDuration, voucherPriceInfos, voucherType]);

  // Default voucher year to the most recent available
  useEffect(() => {
    if (!voucherYear && voucherYears && voucherYears.length > 0) {
      setVoucherYear(Math.max(...voucherYears));
    }
  }, [voucherYear, voucherYears, setVoucherYear]);

  // Auto-fill prices from voucher selection unless user edited manually
  useEffect(() => {
    if (selectedPriceInfo && !pricesManuallyEdited && !preservePrefilledPrices) {
      if (selectedPriceInfo.fullPrice != null) setFullPrice(String(selectedPriceInfo.fullPrice));
      if (selectedPriceInfo.grant != null) setGrant(String(selectedPriceInfo.grant));
      if (selectedPriceInfo.actualPrice != null) setActualPrice(String(selectedPriceInfo.actualPrice));
    }
  }, [
    selectedPriceInfo,
    pricesManuallyEdited,
    preservePrefilledPrices,
    setFullPrice,
    setGrant,
    setActualPrice,
  ]);

  // Business-day end date auto-calc from startDate + duration, on the branch
  // calendar. It runs when the start date or duration changes; a run skipped
  // while the calendar was loading happens once when it becomes ready, and a
  // new calendar object/version alone never recomputes (or overwrites a manual end date).
  useEffect(() => {
    const previousInputs = endDateCalcInputsRef.current;
    endDateCalcInputsRef.current = { startDate, voucherDuration };
    const inputsChanged = previousInputs === null
      || previousInputs.startDate !== startDate
      || previousInputs.voucherDuration !== voucherDuration;
    if (!inputsChanged && !endDateCalcSkippedRef.current) return;
    const kept = keptEndDateInputsRef.current;
    if (kept) {
      if (kept.startDate === startDate && kept.voucherDuration === voucherDuration) {
        endDateCalcSkippedRef.current = false;
        setEndDateUnsupported(false);
        return;
      }
      keptEndDateInputsRef.current = null;
    }
    if (!startDate || !voucherDuration) {
      endDateCalcSkippedRef.current = false;
      setEndDateUnsupported(false);
      return;
    }
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) {
      endDateCalcSkippedRef.current = false;
      setEndDateUnsupported(false);
      return;
    }
    if (!calendarReady) {
      endDateCalcSkippedRef.current = true;
      return;
    }
    endDateCalcSkippedRef.current = false;
    try {
      const endIso = calendarRef.current.calcEndDateBusinessDays(startDate, n);
      setEndDateUnsupported(false);
      if (endIso) setEndDate(endIso);
    } catch {
      // A year the branch calendar does not cover: clear the end date instead of keeping the
      // previous one, and leave it to the user (the server validates a typed date).
      setEndDate("");
      setEndDateUnsupported(true);
    }
  }, [calendarReady, startDate, voucherDuration, setEndDate]);

  const showErrorToast = (message: string) => {
    // Locally authored validation copy renders verbatim — the legacy
    // getUserErrorMessage string adapter is not applied to it.
    toast({ variant: "destructive", description: message });
  };

  const showSubmissionFailure = (
    error: unknown,
    fallbackOutcome: ProblemOutcome = "UNKNOWN",
  ): ContractSubmissionAlert => {
    const alert = buildContractSubmissionAlert(error, fallbackOutcome);
    setSubmissionAlert(alert);
    focusContractValidationErrors(alert.errors, setActiveStep);
    if (alert.locked) {
      submissionLockRef.current = alert;
      setSubmissionLock(alert);
    }
    return alert;
  };

  useEffect(() => () => {
    progressSourceRef.current?.close();
  }, []);

  const formatAreaLabel = (areaId: string): string => getAreaTemplateDisplayLabel(
    areaId,
    areaTemplates?.find((template) => template.areaId === areaId)?.templateName,
  );

  const setLoadedClientBaseline = (baseline: LoadedClientBaseline | null) => {
    loadedClientBaselineRef.current = baseline;
    setRegisteredBaseline(baseline);
  };

  const buildLoadedBaseline = (client: Client): LoadedClientBaseline => ({
    id: client.id,
    snapshot: buildClientDiffSnapshotFromClient(
      { ...client, birthday: normalizeBirthdayInput(clientBirthdayValue(client)) },
      formatAreaLabel,
    ),
    periodLocked: client.serviceRecordPeriodLocked === true,
  });

  // 고객 상세의 "계약서 생성"처럼 스토어에 clientId가 미리 채워진 채로 들어오면 고객 선택 핸들러를 거치지 않아요.
  // 스토어 값은 이미 폼 값으로 가공돼 있으니, 저장값은 같은 /clients 목록의 고객 레코드에서 직접 읽어요.
  // 목록에 아직 없으면 기다리고, 끝내 없으면 기존 동작(비교 없이 저장) 그대로예요. 이번 제출에서 등록·재사용한 고객은 제외해요.
  useEffect(() => {
    if (clientId === null || !allClients) return;
    if (loadedClientBaselineRef.current?.id === clientId) return;
    if (persistedClientIdRef.current === clientId) return;
    const storedClient = allClients.find((candidate) => candidate.id === clientId);
    if (!storedClient) return;
    loadedClientBaselineRef.current = buildLoadedBaseline(storedClient);
    setRegisteredBaseline(loadedClientBaselineRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 고객이 바뀌거나 목록이 도착했을 때만 저장값을 만들어요.
  }, [allClients, clientId]);
  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    const selectedPaymentDate = selectedClientId === clientId ? defaultPaymentDate : todayIsoDate();
    persistedClientIdRef.current = null;
    persistedClientSnapshotRef.current = null;
    retryWithPersistedClientRef.current = false;
    contractOnlyChoiceRef.current = null;
    keptEndDateInputsRef.current = null;
    setLoadedClientBaseline(selectedClientId !== null && client
      ? { ...buildLoadedBaseline(client), id: selectedClientId }
      : null);
    manualAreaChoiceClientRef.current = undefined;
    setClientId(selectedClientId);
    selectedClientRef.current = client;
    setEmployeeSelection(null, "", "");
    setEmployee2Selection(null, "", "");
    setShowEmployee2(false);
    if (client) {
      setName(client.name);
      setPhone(formatPhoneNumber(client.phone || ""));
      setBirthday(normalizeBirthdayInput(clientBirthdayValue(client)));
      setAddress(client.address || "");
      setDueDate(normalizeIsoDate(client.dueDate));
      // 이전 고객의 유형은 버리고 새 고객의 저장된 유형만 골라요. 템플릿이 아직 없으면 위 effect가 나중에 채워요.
      setArea(resolveStoredAreaId(client.areaId, areaTemplates));
      if (client.type) setVoucherType(client.type);
      if (client.duration) setVoucherDuration(client.duration.toString());
      if (client.fullPrice) setFullPrice(client.fullPrice);
      if (client.grant) setGrant(client.grant);
      if (client.actualPrice) setActualPrice(client.actualPrice);
      if (client.startDate) {
        const startNorm = normalizeIsoDate(client.startDate);
        setStartDate(startNorm);
        setPaymentDate(selectedPaymentDate);
      }
      if (client.endDate) {
        setEndDate(normalizeIsoDate(client.endDate));
        setEndDateUnsupported(false);
        if (client.startDate && client.duration) {
          // Show the stored end date as-is; only a start/duration edit recalculates it.
          keptEndDateInputsRef.current = {
            startDate: normalizeIsoDate(client.startDate),
            voucherDuration: client.duration.toString(),
          };
          endDateCalcSkippedRef.current = false;
        }
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
      setIsManualEntry(false);
    } else {
      setName(""); setPhone(""); setBirthday(""); setAddress(""); setDueDate("");
      setVoucherType(""); setVoucherDuration("");
      setFullPrice(""); setGrant(""); setActualPrice("");
      setStartDate(""); setEndDate(""); setPaymentDate(selectedPaymentDate);
      setArea("");
      setEmployeeSelection(null, "", "");
      setEmployee2Selection(null, "", "");
      setShowEmployee2(false);
    }
    setPricesManuallyEdited(false);
  };

  const handleClientNameInputChange = (nextName: string) => {
    const isNameChanging = nextName !== name;
    if (isNameChanging) {
      persistedClientIdRef.current = null;
      persistedClientSnapshotRef.current = null;
      retryWithPersistedClientRef.current = false;
    }
    setName(nextName);
    const matchesSelectedClient = clientId !== null && selectedClientRef.current?.name === nextName;
    const hasSelectedClientSnapshot = clientId !== null && selectedClientRef.current !== null;
    const willClearSelectedClient = hasSelectedClientSnapshot && !matchesSelectedClient;
    if (willClearSelectedClient) {
      setClientId(null);
      setLoadedClientBaseline(null);
      selectedClientRef.current = null;
      setArea("");
    } else if (isNameChanging && clientId === null && area) {
      setArea("");
    }
    setIsManualEntry(Boolean(nextName.trim()) && !matchesSelectedClient && (clientId === null || willClearSelectedClient));
  };

  const handleClientManualEntry = (query: string) => {
    persistedClientIdRef.current = null;
    persistedClientSnapshotRef.current = null;
    retryWithPersistedClientRef.current = false;
    contractOnlyChoiceRef.current = null;
    setClientId(null);
    setLoadedClientBaseline(null);
    selectedClientRef.current = null;
    setName(query.trim() || name);
    setArea("");
    setIsManualEntry(true);
  };

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

  const handleEmployee2VisibilityChange = (checked: boolean) => {
    setShowEmployee2(checked);
    if (!checked) {
      setEmployee2Selection(null, "", "");
    }
  };

  const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
    setPricesManuallyEdited(true);
    if (field === "fullPrice") setFullPrice(value);
    else if (field === "grant") setGrant(value);
    else setActualPrice(value);
  };

  const handleVoucherTypeChange = (next: string) => {
    setVoucherType(next);
    setVoucherDuration("");
    setFullPrice(""); setGrant(""); setActualPrice("");
    setPricesManuallyEdited(false);
  };

  const handleDurationChange = (next: string) => {
    setVoucherDuration(next);
    setPricesManuallyEdited(false);
  };


  const phoneProblem = getPhoneProblem(phone);
  const birthdayProblem = getBirthdayProblem(birthday, isValidBirthdayIsoDate);
  const isStep1Valid = Boolean(
    !clientsDataUnavailable && !birthdayProblem && !phoneProblem &&
    (clientId !== null || (isManualEntry && name.trim())) && area
  );
  const isEmployee1Valid = employeeId !== null;
  const isEmployee2Valid = !showEmployee2 || employee2Id !== null;
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  const contractDateProblem = getContractDateProblem({
    startDateInput,
    endDateInput,
    paymentDateInput: effectivePaymentDateInput,
  });
  const isStep4Valid = contractDateProblem === null;
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid][activeStep] ?? true;

  const buildFormDiffSnapshot = (): ClientDiffSnapshot => buildClientDiffSnapshotFromForm({
    phone,
    birthday,
    address,
    areaId: area,
    primaryEmployeeId: employeeId,
    primaryEmployeeName: employeeName,
    secondaryEmployeeId: showEmployee2 ? employee2Id : null,
    secondaryEmployeeName: employee2Name,
    type: voucherType,
    duration: voucherDuration,
    fullPrice,
    grant,
    actualPrice,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
  }, formatAreaLabel);

  // 기존 고객을 골라 저장값이 있을 때만 필드별 힌트와 저장값 placeholder를 보여줘요. 새 고객·자동 등록 고객·고객 미선택이면 없어요.
  const registeredSnapshot = clientId !== null && registeredBaseline?.id === clientId
    ? registeredBaseline.snapshot
    : null;
  const registeredDiffKeys = registeredSnapshot
    ? getRegisteredDiffKeys(registeredSnapshot, buildFormDiffSnapshot())
    : NO_REGISTERED_DIFF_KEYS;
  // 등록값 다름 힌트(초록)예요. 필드 메시지 슬롯 안에서 오류·형식 힌트보다 뒤에 와요.
  const getRegisteredHint = (key: ClientDiffKey | null): FieldLabelMessage | null => {
    if (key === null || !registeredDiffKeys.has(key)) return null;
    return { slot: "registered-value-diff-hint", id: getRegisteredDiffHintId(key), text: REGISTERED_VALUE_DIFF_HINT };
  };
  // 필드 하나가 라벨 줄에 보여줄 메시지예요. 검증 오류·형식 힌트(primary) > 등록값 다름 힌트 중 하나만 보여줘요.
  const getLabelMessage = (
    key: ClientDiffKey | null,
    primary?: ContractFormFieldMessage | null,
  ): ContractFormFieldMessage | null => primary ?? getRegisteredHint(key);
  // 저장값이 있으면 입력칸을 비워도 저장값이 보이도록 placeholder로 써요. 없으면 기본 placeholder를 그대로 둬요.
  const registeredPlaceholder = (
    key: ClientDiffKey,
    fallback: string,
    format: (value: string) => string = (value) => value,
  ): string => {
    const stored = registeredSnapshot?.[key].value;
    return stored ? format(stored) : fallback;
  };

  const isStepSubmitted = (step: number): boolean => submittedSteps.has(step);
  const revealStepMessages = (step: number) => {
    setSubmittedSteps((current) => (current.has(step) ? current : new Set(current).add(step)));
  };
  const buildFieldMessage = (
    key: ContractFieldKey,
    message: ReturnType<typeof resolveFieldMessage>,
    text?: string,
  ): ContractFormFieldMessage | null => {
    if (!message) return null;
    const isError = message.tone === "error";
    const isContractDate = key === "startDate" || key === "endDate" || key === "paymentDate";
    return {
      slot: isError ? "field-error-message" : "field-hint-message",
      id: `contracts-new-${key}-message`,
      text: text ?? getFieldMessageText(key, message),
      ...(isError && isContractDate ? { testId: CONTRACT_DATE_ERROR_TEST_ID } : {}),
    };
  };

  const phoneFieldMessage = buildFieldMessage("phone", resolveFieldMessage(
    "phone",
    fieldInteractions.getState("phone", phone),
    { required: true, submitted: isStepSubmitted(0) },
  ));
  const birthdayResolved = resolveBirthdayMessage(
    fieldInteractions.getState("birthday", birthday),
    isStepSubmitted(0),
    isValidBirthdayIsoDate,
  );
  const birthdayFieldMessage = buildFieldMessage(
    "birthday",
    birthdayResolved,
    birthdayResolved ? getBirthdayMessageText(birthdayResolved) : undefined,
  );
  // 시작일은 1단계(선택)와 4단계(필수)에 같은 값으로 나와요.
  const startDateFieldMessage = buildFieldMessage("startDate", resolveFieldMessage(
    "date",
    fieldInteractions.getState("startDate", startDateInput),
    { required: isContractInfoStep, submitted: isStepSubmitted(activeStep) },
  ));
  const endDateFieldMessage = buildFieldMessage("endDate", resolveFieldMessage(
    "date",
    fieldInteractions.getState("endDate", endDateInput),
    { required: true, submitted: isStepSubmitted(activeStep), dateRange: { notBefore: startDateInput } },
  ));
  const paymentDateFieldMessage = buildFieldMessage("paymentDate", resolveFieldMessage(
    "date",
    fieldInteractions.getState("paymentDate", effectivePaymentDateInput),
    { required: true, submitted: isStepSubmitted(activeStep) },
  ));
  const primaryEmployeeMessage = getRegisteredHint("primaryEmployeeId");
  const secondaryEmployeeMessage = getRegisteredHint("secondaryEmployeeId");
  const startDateMessage = getLabelMessage("startDate", startDateFieldMessage);
  const endDateMessage = getLabelMessage("endDate", endDateFieldMessage)
    ?? { slot: "field-info-message" as const, id: "contracts-new-endDate-info", text: END_DATE_AUTO_CALC_INFO };
  const paymentDateMessage = getLabelMessage(null, paymentDateFieldMessage);

  // 다음/생성을 눌렀는데 막혀 있으면 첫 문제 필드로 이동해요. 이 화면이 직접 메시지를 그리는 필드(연락처·생년월일·계약 날짜)만 대상이에요.
  const getFirstProblemSelector = (step: number): string | null => {
    if (step === 0) {
      if (phoneProblem) return PHONE_INPUT_SELECTOR;
      if (birthdayProblem) return BIRTHDAY_INPUT_SELECTOR;
    }
    if (step === WIZARD_STEPS.length - 1 && contractDateProblem) {
      return CONTRACT_DATE_INPUT_SELECTORS[contractDateProblem.field];
    }
    return null;
  };

  const getStepValidationMessage = (step: number): string | null => {
    if (step === 0 && clientsDataUnavailable) return "고객 목록을 불러온 뒤 다시 시도해 주세요";
    if (step === 0 && !isStep1Valid) return "고객 정보와 계약서를 선택해 주세요";
    if (step === 1 && !isStep2Valid) return "등록된 제공인력을 목록에서 선택해 주세요";
    if (step === 2 && !isStep3Valid) return "바우처 유형/기간과 금액 정보를 입력해 주세요";
    if (step === 3 && !isStep4Valid) return "계약 시작일, 종료일, 본인부담금 수령 날짜를 입력해 주세요";
    return null;
  };

  const handleNext = () => {
    if (activeStep === 0 && clientsDataUnavailable) {
      showErrorToast("고객 목록을 불러온 뒤 다시 시도해 주세요");
      return;
    }
    if (!isCurrentStepValid) {
      revealStepMessages(activeStep);
      const selector = getFirstProblemSelector(activeStep);
      if (selector && focusContractField(selector)) return;
      const msg = getStepValidationMessage(activeStep);
      if (msg) showErrorToast(msg);
      return;
    }
    if (activeStep === WIZARD_STEPS.length - 1) {
      if (hasExistingContractRecord) {
        setIsExistingContractConfirmOpen(true);
        return;
      }
      void handleSubmit();
      return;
    }
    setActiveStep((s) => s + 1);
  };

  const handlePrev = () => {
    if (activeStep === 0) return;
    setActiveStep((s) => s - 1);
  };

  const closeEformsignModal = () => {
    setIsEformsignModalOpen(false);
    setIsSubmitting(false);
    submissionInFlightRef.current = false;
    iframeOutcomeConfirmedRef.current = false;
  };

  const handleEformsignModalClose = () => {
    // Closing the signing surface without a validated callback leaves the
    // provider outcome unknown. Keep the durable submission lock in place so
    // the user cannot accidentally create a second contract.
    if (submissionInFlightRef.current && !iframeOutcomeConfirmedRef.current) {
      setCreationProgress((current) => ({
        step: current.step ?? "client-started",
        completed: false,
        failed: true,
      }));
      setProgressErrorHint(CONTRACT_OUTCOME_COPY.UNKNOWN.message);
      showSubmissionFailure(new Error("The signing result was not confirmed"), "UNKNOWN");
    }
    closeEformsignModal();
  };

  const runIframeFallback = async (
    contractData: ContractDataDto,
    finalClientId: number,
    expiry: dayjs.Dayjs,
  ): Promise<boolean> => {
    if (!isEformsignLoaded) {
      showErrorToast("eformsign SDK를 아직 불러오는 중이에요. 잠시 후 다시 시도해 주세요");
      return false;
    }
    const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
      contractData as unknown as Parameters<typeof eformsignApi.generateDocument>[0],
      finalClientId,
    );
    if (!isRecord(documentOption) || !isRecord(documentOption.mode)) {
      throw new Error("The signing document response was invalid");
    }
    iframeOutcomeConfirmedRef.current = false;
    setIsEformsignModalOpen(true);
    setTimeout(() => {
      openDocument(documentOption, "eformsign_iframe", {
        onSuccess: async (response) => {
          if (!isValidIframeSuccessResponse(response)) {
            showSubmissionFailure(response, "UNKNOWN");
            closeEformsignModal();
            return;
          }
          try {
            await eformsignApi.createDocRecord(buildInitialSignRequestDocRecord({
              documentId: response.document_id,
              clientId: finalClientId,
              stepRecipientName: name,
              stepRecipientSms: phone,
              expiredDate: expiry.add(30, "day").toISOString(),
              linkToClient: true,
            }));
          } catch (docError) {
            showSubmissionFailure(docError, "UNKNOWN");
            closeEformsignModal();
            return;
          }
          iframeOutcomeConfirmedRef.current = true;
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
          supersedePreviousContract(finalClientId);
          startNavigation();
          setTimeout(() => {
            closeEformsignModal();
            router.push("/contracts");
          }, SUCCESS_REDIRECT_DELAY_MS);
        },
        onError: (response) => {
          iframeOutcomeConfirmedRef.current = true;
          showSubmissionFailure(response, "FAILED");
          closeEformsignModal();
        },
        onAction: () => { /* noop */ },
      });
    }, 500);
    return true;
  };

  const handleSubmit = async () => {
    // The saved end date depends on the branch calendar.
    if (!calendarReady || endDateUnsupported) return;
    if (contractDateProblem) {
      setActiveStep(WIZARD_STEPS.length - 1);
      revealStepMessages(WIZARD_STEPS.length - 1);
      window.setTimeout(() => focusContractField(CONTRACT_DATE_INPUT_SELECTORS[contractDateProblem.field]), 0);
      return;
    }
    if (birthdayProblem) {
      setActiveStep(0);
      revealStepMessages(0);
      window.setTimeout(() => focusContractField(BIRTHDAY_INPUT_SELECTOR), 0);
      return;
    }
    // React state updates are asynchronous; this ref closes the same-tick
    // double-click window before the first network mutation starts.
    if (submissionLockRef.current || submissionInFlightRef.current || isSubmitting) return;
    if (employeeId === null || (showEmployee2 && employee2Id === null)) {
      setActiveStep(1);
      showErrorToast("등록된 제공인력을 목록에서 선택해 주세요");
      return;
    }
    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setSubmissionAlert(null);
    setProgressErrorHint(null);

    let keepSubmittingUntilIframeCloses = false;
    try {
      // 1. Manual-entry client creation. The confirmed id is retained in the
      // form store so an uncertain dispatch never suggests deleting it.
      const reusePersistedClient = retryWithPersistedClientRef.current;
      retryWithPersistedClientRef.current = false;
      let finalClientId = reusePersistedClient
        ? persistedClientIdRef.current ?? clientId ?? storedClientByIdentity?.id ?? storedClientByPhone?.id ?? null
        : clientId ?? storedClientByIdentity?.id ?? storedClientByPhone?.id ?? null;
      const assignment = {
        primaryEmployeeId: employeeId,
        secondaryEmployeeId: showEmployee2 ? employee2Id : null,
      };
      const clientData = {
        ...assignment,
        name,
        phone,
        birthday: birthday || undefined,
        address: address || null,
        dueDate: dueDate || effectiveStartDate || undefined,
        type: voucherType || null,
        duration: Number(voucherDuration) || null,
        fullPrice: fullPrice || null,
        grant: grant || null,
        actualPrice: actualPrice || null,
        startDate: effectiveStartDate || null,
        endDate: effectiveEndDate || null,
        areaId: area || null,
      };
      const clientPersistenceSnapshot = JSON.stringify(clientData);

      // 기존 고객을 골랐고 입력값이 저장된 고객 정보와 다르면 어떻게 반영할지 먼저 물어봐요.
      // 자동 등록·새로 만든 고객은 이 확인을 거치지 않아요.
      const loadedBaseline = clientId !== null && loadedClientBaselineRef.current?.id === clientId
        ? loadedClientBaselineRef.current
        : null;
      const omitPeriodFields = loadedBaseline?.periodLocked === true;
      let clientUpdateMode: "full" | "assignment-only" | "skip" = "full";
      let formDiffSnapshot: ClientDiffSnapshot | null = null;
      if (loadedBaseline && clientId !== null) {
        const formSnapshot = buildFormDiffSnapshot();
        formDiffSnapshot = formSnapshot;
        const diffRows = diffClientSnapshots(loadedBaseline.snapshot, formSnapshot);
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
          if (decision === "cancel") return;
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

      if (!reusePersistedClient && !finalClientId && isManualEntry) {
        const autoRegistrationPayload = {
          ...clientData,
          careCenter: false,
          voucherClient: true,
          breastPump: false,
          source: "contract_auto_registration" as const,
        };
        let newClient: unknown;
        try {
          newClient = await createClientMutation.mutateAsync(autoRegistrationPayload);
        } catch (error) {
          if (!isAxiosError<{ message?: string; error?: string; clientId?: number; code?: string }>(error) || error.response?.status !== 409) {
            showSubmissionFailure(error, "UNKNOWN");
            return;
          }
          const conflict = error.response.data;
          // 중복 판별은 공개 계약 코드로 하고, 배포 전환 구간에는 레거시
          // clientId 페이로드도 받아든다.
          const isDuplicatePhone = conflict.code === "CLIENT_PHONE_ALREADY_REGISTERED" || Boolean(conflict.clientId);
          if (!isDuplicatePhone) {
            showSubmissionFailure(error, "NOT_APPLIED");
            return;
          }
          const shouldReuse = await requestConfirmation("이미 같은 전화번호의 고객이 있습니다. 기존 고객으로 계약을 진행할까요?");
          if (!shouldReuse) return;
          try {
            newClient = await createClientMutation.mutateAsync({ ...autoRegistrationPayload, reuseExistingClient: true });
          } catch (reuseError) {
            showSubmissionFailure(reuseError, "UNKNOWN");
            return;
          }
        }
        if (!isRecord(newClient) || !isSafeClientId(newClient.id)) {
          showSubmissionFailure(new Error("The customer response was invalid"), "UNKNOWN");
          return;
        }
        finalClientId = newClient.id;
        setClientId(finalClientId);
      }
      if (!finalClientId) {
        showErrorToast("고객 정보를 먼저 선택하거나 등록해 주세요.");
        return;
      }
      const shouldUpdatePersistedClient = clientUpdateMode === "skip"
        ? false
        : reusePersistedClient
          ? persistedClientSnapshotRef.current !== clientPersistenceSnapshot
          : clientId !== null || storedClientByIdentity || storedClientByPhone;
      if (shouldUpdatePersistedClient) {
        try {
          await updateClientMutation.mutateAsync({
            id: finalClientId,
            dto: clientUpdateMode === "assignment-only"
              ? { ...assignment }
              // 서비스 기록이 확정된 고객은 계약 기간을 계약서에만 반영해요. 키를 빼면 저장된 값이 그대로 남아요.
              : omitPeriodFields
                ? Object.fromEntries(
                  Object.entries(clientData).filter(([key]) => !CLIENT_PERIOD_DTO_KEYS.has(key)),
                ) as Partial<typeof clientData>
                : clientData,
          });
        } catch (error) {
          showSubmissionFailure(error, "UNKNOWN");
          return;
        }
        // 저장된 값이 바뀌었으니 다음 비교는 방금 저장한 값을 기준으로 해요.
        if (loadedBaseline && formDiffSnapshot) {
          const persistedSnapshot: ClientDiffSnapshot = { ...loadedBaseline.snapshot };
          for (const key of Object.keys(persistedSnapshot) as ClientDiffKey[]) {
            const isAssignmentKey = key === "primaryEmployeeId" || key === "secondaryEmployeeId";
            if (clientUpdateMode === "assignment-only" && !isAssignmentKey) continue;
            if (omitPeriodFields && CLIENT_PERIOD_DIFF_KEYS.has(key)) continue;
            persistedSnapshot[key] = formDiffSnapshot[key];
          }
          loadedBaseline.snapshot = persistedSnapshot;
          setRegisteredBaseline({ ...loadedBaseline, snapshot: persistedSnapshot });
        }
      }
      if (!reusePersistedClient || shouldUpdatePersistedClient) {
        persistedClientIdRef.current = finalClientId;
        persistedClientSnapshotRef.current = clientPersistenceSnapshot;
      }

      // Provider identity remains server-owned; this page sends only contract data.
      // 2. Build contract data for the server-mediated dispatch operation.
      const start = dayjs(effectiveStartDate);
      const end = dayjs(effectiveEndDate);
      const payment = dayjs(effectivePaymentDate);
      const contractData: ContractDataDto = {
        customerName: name,
        customerContact: phone,
        customerDOB: birthday,
        customerAddress: address,
        caretaker1Name: employeeName,
        caretaker1Contact: employeePhone,
        type: voucherType,
        days: voucherDuration,
        area,
        contractDuration: `${start.format("YYYY-MM-DD")} ~ ${end.format("YYYY-MM-DD")}`,
        startYear: start.format("YY"), startMonth: start.format("MM"), startDay: start.format("DD"), startDate: effectiveStartDate,
        endYear: end.format("YY"), endMonth: end.format("MM"), endDay: end.format("DD"), endDate: effectiveEndDate,
        paymentYear: payment.format("YY"), paymentMonth: payment.format("MM"), paymentDay: payment.format("DD"),
        fullPrice, grant, actualPrice,
      };

      // 3. Headless dispatch (primary path).
      const progressId = createHeadlessProgressId();
      let headlessFailureReason: unknown;
      let headlessFailureStep: unknown;
      let headlessFallbackHint: unknown;
      let progressSource: EventSource | null = null;
      setCreationProgress({ step: "client-started", completed: false, failed: false });
      setIsProgressModalOpen(true);

      try {
        progressSource = await openAuthenticatedEventSource(
          `/api/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
        );
        progressSourceRef.current = progressSource;
        progressSource.addEventListener("progress", (event) => {
          let data: HeadlessProgressEvent;
          try { data = JSON.parse((event as MessageEvent).data) as HeadlessProgressEvent; }
          catch { return; }
          if (data.step === "failed") {
            // getSafeHeadlessFailureMessage is a locally authored allowlist
            // adapter: the upstream raw reason never reaches the UI verbatim.
            const errorHint = getSafeHeadlessFailureMessage(data.reason);
            setCreationProgress((current) => {
              const next = resolveFailedHeadlessProgress(
                current,
                data.failedStep,
                CONTRACT_CREATION_PROGRESS_STEPS,
              );
              if (next !== current) setProgressErrorHint(errorHint);
              return next;
            });
            headlessFailureReason = data.reason;
            headlessFailureStep = data.failedStep;
            return;
          }
          const nextStep = data.step;
          if (!isHeadlessProgressStepKey(nextStep, CONTRACT_CREATION_PROGRESS_STEPS)) return;
          setCreationProgress((current) =>
            resolveNextHeadlessProgress(current, nextStep, CONTRACT_CREATION_PROGRESS_STEPS),
          );
        });

        const headless: unknown = await eformsignApi.dispatchHeadless(
          contractData as unknown as Parameters<typeof eformsignApi.dispatchHeadless>[0],
          finalClientId,
          progressId,
        );

        if (isHeadlessSuccessResponse(headless)) {
          supersedePreviousContract(finalClientId);
          startNavigation();
          setCreationProgress({ step: "sent", completed: true, failed: false });
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
          setTimeout(() => {
            setIsProgressModalOpen(false);
            router.push("/contracts");
          }, SUCCESS_REDIRECT_DELAY_MS);
          return;
        }

        // A typed ProblemDetails response is already sanitized by the shared
        // parser. Preserve its request/operation ids and factual outcome.
        const normalizedHeadless = normalizeApiError(headless, {
          operation: "mutation",
          locale: "ko-KR",
        });
        const knownHeadlessFailure = !normalizedHeadless.verified
          && isRecord(headless)
          && headless.ok === false
          ? buildHeadlessProviderFailureAlert(headless.reason)
          : null;
        if (knownHeadlessFailure) {
          setCreationProgress((current) => resolveFailedHeadlessProgress(
            current,
            isRecord(headless) && typeof headless.failedStep === "string" ? headless.failedStep : undefined,
            CONTRACT_CREATION_PROGRESS_STEPS,
          ));
          setProgressErrorHint(knownHeadlessFailure.message);
          setSubmissionAlert(knownHeadlessFailure);
          setIsProgressModalOpen(false);
          retryWithPersistedClientRef.current = true;
          return;
        }
        if (normalizedHeadless.verified) {
          setProgressErrorHint(normalizedHeadless.message);
          showSubmissionFailure(headless, normalizedHeadless.problem?.outcome ?? "UNKNOWN");
          return;
        }
        if (!isRecord(headless) || headless.ok !== false) {
          setProgressErrorHint(CONTRACT_OUTCOME_COPY.UNKNOWN.message);
          showSubmissionFailure(new Error("The contract dispatch response was invalid"), "UNKNOWN");
          return;
        }

        headlessFailureReason = headless.reason;
        headlessFailureStep = headless.failedStep;
        headlessFallbackHint = headless.fallbackHint;

        // BJJ-319 5-4c: the structured outcome is the primary classification
        // when the envelope carries it. An UNKNOWN verdict means the provider
        // send boundary may already be crossed, so the response must surface
        // the 확인 필요 copy and keep the submission locked — no iframe, no
        // retry. Envelopes without the field keep the legacy branches below.
        if (readHeadlessOutcome(headless.outcome) === "UNKNOWN") {
          setProgressErrorHint(CONTRACT_OUTCOME_COPY.UNKNOWN.message);
          showSubmissionFailure(headless, "UNKNOWN");
          return;
        }

        const remoteDocumentId = typeof headless.remoteDocumentId === "string"
          && headless.remoteDocumentId.trim().length > 0
          ? headless.remoteDocumentId
          : null;
        if ((headless.reason === "local_persist_failed" || readHeadlessOutcome(headless.outcome) === "PARTIALLY_APPLIED") && remoteDocumentId) {
          try {
            const adopted = await eformsignApi.adoptDocument(remoteDocumentId, finalClientId);
            if (adopted.warnings?.includes("mirror_sync_failed")) {
              queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
              setCreationProgress((current) => ({
                step: current.step ?? "client-started",
                completed: false,
                failed: true,
              }));
              setProgressErrorHint("전자문서와 PDF 동기화가 완료되지 않았습니다. 계약 목록에서 상태를 확인해 주세요.");
              showSubmissionFailure(adopted, "UNKNOWN");
              return;
            }
            if (typeof adopted.documentId !== "string" || adopted.documentId.trim().length === 0) {
              setProgressErrorHint(CONTRACT_OUTCOME_COPY.UNKNOWN.message);
              showSubmissionFailure(new Error("The adopted document response was invalid"), "UNKNOWN");
              return;
            }
            supersedePreviousContract(finalClientId);
            startNavigation();
            setCreationProgress({ step: "sent", completed: true, failed: false });
            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() });
            setTimeout(() => { setIsProgressModalOpen(false); router.push("/contracts"); }, SUCCESS_REDIRECT_DELAY_MS);
          } catch (error) {
            setProgressErrorHint("전자문서 등록 상태를 확인할 수 없어 계약 목록에서 확인해 주세요.");
            showSubmissionFailure(error, "UNKNOWN");
          }
          return;
        }

        if (readHeadlessOutcome(headless.outcome) === "PARTIALLY_APPLIED") {
          // The verdict says the document exists but could not be adopted here
          // and no remote id was provided to retry the adoption with. Surface
          // the shared check-list copy and keep the submission locked.
          setProgressErrorHint(CONTRACT_OUTCOME_COPY.PARTIALLY_APPLIED.message);
          showSubmissionFailure(headless, "PARTIALLY_APPLIED");
          return;
        }

        if (headless.reason === "remote_unconfirmed"
          || headless.fallbackHint === "manual_check"
          || headless.fallbackHint === "adopt-or-manual"
          || headless.reason === "dispatch_uncertain_manual_reconciliation_required") {
          setProgressErrorHint(CONTRACT_OUTCOME_COPY.UNKNOWN.message);
          showSubmissionFailure(headless, "UNKNOWN");
          return;
        }
        if (headless.reason === "duplicate_pending_document") {
          setProgressErrorHint("최근 생성된 진행 중 문서가 있어 계약 목록에서 상태를 확인해 주세요.");
          showSubmissionFailure(headless, "UNKNOWN");
          return;
        }

        const safeFallback = canUseContractIframeFallback({
          fallbackHint: headlessFallbackHint,
          failedStep: headlessFailureStep,
          reason: headlessFailureReason,
        });
        if (safeFallback) {
          setProgressErrorHint(getSafeHeadlessFailureMessage(
            typeof headlessFailureReason === "string" ? headlessFailureReason : undefined,
          ));
          setIsProgressModalOpen(false);
          try {
            keepSubmittingUntilIframeCloses = await runIframeFallback(contractData, finalClientId, end);
          } catch (error) {
            showSubmissionFailure(error, "UNKNOWN");
          }
          return;
        }

        setProgressErrorHint(getSafeHeadlessFailureMessage(
          typeof headlessFailureReason === "string" ? headlessFailureReason : undefined,
        ));
        showSubmissionFailure(headless, "UNKNOWN");
      } catch (headlessError) {
        // A thrown dispatch has no server guarantee that the provider was not
        // reached. Do not open the iframe or permit a blind replay.
        setCreationProgress((current) => resolveFailedHeadlessProgress(
          current,
          undefined,
          CONTRACT_CREATION_PROGRESS_STEPS,
        ));
        setProgressErrorHint(CONTRACT_OUTCOME_COPY.UNKNOWN.message);
        showSubmissionFailure(headlessError, "UNKNOWN");
        return;
      } finally {
        progressSource?.close();
        progressSourceRef.current = null;
      }
    } catch (error: unknown) {
      setIsProgressModalOpen(false);
      showSubmissionFailure(error, "UNKNOWN");
    } finally {
      if (!keepSubmittingUntilIframeCloses) {
        setIsSubmitting(false);
        submissionInFlightRef.current = false;
      }
    }
  };

  const goBack = () => router.push("/contracts");
  const progress = ((activeStep + 1) / WIZARD_STEPS.length) * 100;
  const activeStepMeta = WIZARD_STEPS[activeStep];
  const isFirstStep = activeStep === 0;
  const isLastStep = isContractInfoStep;
  const isBusy = isSubmitting || isNavigationPending;
  const isPrimaryDisabled = isBusy || Boolean(submissionLock) || (isLastStep && (!calendarReady || endDateUnsupported));

  return (
    <>
      <div
        className={styles.pageRoot}
        data-component="mobile_contracts-new_screen_root"
        data-slot="contract-creation-screen"
      >
        <div className={styles.navPage} data-component="mobile_contracts-new_screen_root_page">
          <header className={styles.navbar} data-component="mobile_contracts-new_screen_root_page_root">
            <button
              data-component="mobile_contracts-new_screen_root_page_root_back-button"
              type="button"
              onClick={goBack}
              className={styles.navbarIconButton}
              aria-label="계약 목록으로 돌아가기"
            >
              <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
            <div className={styles.navbarTitle} data-component="mobile_contracts-new_screen_root_page_root_title">계약서 생성</div>
            <button
              data-component="mobile_contracts-new_screen_root_page_root_close-button"
              type="button"
              onClick={goBack}
              className={styles.navbarIconButton}
              aria-label="계약서 생성 닫기"
            >
              <X aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
          </header>

          <section className={styles.wizardContent} data-component="mobile_contracts-new_screen_root_page_root">
            {showClientsError ? (
              <Alert
                variant="warning"
                role="status"
                aria-live="polite"
                data-component="mobile_contracts-new_screen_clients-read-error"
                className="mb-4"
              >
                <AlertTitle>고객 목록을 새로 불러오지 못했어요</AlertTitle>
                <AlertDescription>
                  <p>{clientsNormalizedError?.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void refetchClients()}
                    disabled={isClientsFetching}
                  >
                    다시 시도
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {submissionAlert ? (
              <Alert
                variant="warning"
                role="alert"
                aria-live="assertive"
                data-component="mobile_contracts-new_screen_root_submission-alert"
              >
                <AlertTitle data-component="mobile_contracts-new_screen_root_submission-alert_title">
                  {submissionAlert.title}
                </AlertTitle>
                <AlertDescription data-component="mobile_contracts-new_screen_root_submission-alert_description">
                  <p>{submissionAlert.message}</p>
                  {submissionAlert.errors?.length ? (
                    <ul>
                      {submissionAlert.errors.map((error, index) => (
                        <li key={`${error.pointer}-${error.code}-${index}`}>{error.detail}</li>
                      ))}
                    </ul>
                  ) : null}
                  {submissionAlert.requestId ? (
                    <p data-component="mobile_contracts-new_screen_root_submission-alert_request-id">
                      요청 ID: {submissionAlert.requestId}
                    </p>
                  ) : null}
                  {submissionAlert.operationId ? (
                    <p data-component="mobile_contracts-new_screen_root_submission-alert_operation-id">
                      작업 ID: {submissionAlert.operationId}
                    </p>
                  ) : null}
                  {submissionAlert.locked ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/contracts")}
                      data-component="mobile_contracts-new_screen_root_submission-alert_status-button"
                    >
                      계약 목록에서 상태 확인
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className={styles.wizardHeader} data-component="mobile_contracts-new_screen_root_page_root_header">
              <div className={styles.progressRow} data-component="mobile_contracts-new_screen_root_page_root_header_progress-row">
                <div className={styles.progressTrack} data-component="mobile_contracts-new_screen_root_page_root_header_progress-row_progress-track" aria-hidden="true">
                  <div
                    className={styles.progressFill}
                    data-component="mobile_contracts-new_screen_root_page_root_header_progress-row_progress-track_progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className={styles.stepCount} data-component="mobile_contracts-new_screen_root_page_root_header_progress-row_step-count">
                  <span>{activeStep + 1}</span> / {WIZARD_STEPS.length} 단계
                </div>
              </div>
              <h1 className={styles.stepTitle} data-component="mobile_contracts-new_screen_root_page_root_header_step-title">
                {activeStepMeta.title}
              </h1>
              <p className={styles.stepDesc} data-component="mobile_contracts-new_screen_root_page_root_header_step-description">
                {activeStepMeta.desc}
              </p>
            </div>

            <div className={styles.formScroll} data-component="mobile_contracts-new_screen_root_page_root_form-scroll">
              {activeStep === 0 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_card-title">
                      이용자 정보
                      <span className={styles.optionalBadge}>기존 고객 또는 직접 입력</span>
                    </div>
                    <ContractFormField dataComponent="mobile_contracts-new_client_name-field" label="이름" required>
                      <ClientAutocomplete
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_autocomplete"
                        inputId="contract-create-client-name"
                        value={clientId}
                        onChange={handleClientSelect}
                        inputValue={name}
                        onInputValueChange={handleClientNameInputChange}
                        label=""
                        allowManualEntry
                        manualEntryLabel="직접 입력으로 진행"
                        manualEntryDescription="입력한 이름으로 새 계약을 작성합니다"
                        onManualEntry={handleClientManualEntry}
                      />
                    </ContractFormField>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_client_phone-field"
                      label="연락처"
                      required
                      message={getLabelMessage("phone", phoneFieldMessage)}
                    >
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input"
                        className={styles.formInput}
                        value={phone}
                        onChange={(e) => {
                          const nextPhone = formatPhoneNumber(e.target.value);
                          fieldInteractions.onChange("phone", phone, nextPhone);
                          setPhone(nextPhone);
                        }}
                        onFocus={() => fieldInteractions.onFocus("phone")}
                        onBlur={(e) => fieldInteractions.onBlur("phone", e.currentTarget.value)}
                        type="tel"
                        inputMode="numeric"
                        maxLength={20}
                        placeholder={registeredPlaceholder("phone", PHONE_PLACEHOLDER, formatPhoneNumber)}
                        aria-invalid={phoneFieldMessage?.slot === "field-error-message" ? "true" : undefined}
                        aria-describedby={getLabelMessage("phone", phoneFieldMessage)?.id}
                      />
                    </ContractFormField>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_client_birthday-field"
                      label="생년월일"
                      message={getLabelMessage("birthday", birthdayFieldMessage)}
                    >
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_birthday-input"
                        className={styles.formInput}
                        value={birthday}
                        onChange={(e) => {
                          const nextBirthday = formatIsoDateInput(e.target.value);
                          fieldInteractions.onChange("birthday", birthday, nextBirthday);
                          setBirthday(nextBirthday);
                        }}
                        onFocus={() => fieldInteractions.onFocus("birthday")}
                        onBlur={(e) => fieldInteractions.onBlur("birthday", e.currentTarget.value)}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder={registeredPlaceholder("birthday", BIRTHDAY_PLACEHOLDER)}
                        aria-invalid={birthdayFieldMessage?.slot === "field-error-message" ? "true" : undefined}
                        aria-describedby={getLabelMessage("birthday", birthdayFieldMessage)?.id}
                      />
                    </ContractFormField>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_client_start-date-field"
                      label="서비스 시작일"
                      message={startDateMessage}
                    >
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_start-date-input"
                        className={styles.formInput}
                        value={startDateInput}
                        onChange={(e) => {
                          fieldInteractions.onChange("startDate", startDateInput, formatIsoDateInput(e.target.value));
                          handleDateInputChange(setStartDateInput, setStartDate, e.target.value);
                        }}
                        onFocus={() => fieldInteractions.onFocus("startDate")}
                        onBlur={(e) => fieldInteractions.onBlur("startDate", e.currentTarget.value)}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder={registeredPlaceholder("startDate", START_DATE_PLACEHOLDER)}
                        aria-invalid={startDateFieldMessage?.slot === "field-error-message" ? "true" : undefined}
                        aria-describedby={startDateMessage?.id}
                      />
                    </ContractFormField>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_client_address-field"
                      label="주소"
                      message={getLabelMessage("address")}
                    >
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_address-input"
                        className={styles.formInput}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={registeredPlaceholder("address", "서울시 강남구...")}
                        aria-describedby={getLabelMessage("address")?.id}
                      />
                    </ContractFormField>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_area-card">
                    <ContractFormField
                      dataComponent="mobile_contracts-new_client_area-field"
                      label="계약서 유형"
                      required
                      message={getLabelMessage("areaId")}
                    >
                      <div className={styles.selectWrap}>
                        <select
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_area-card_area-select"
                          className={styles.formInput}
                          value={area}
                          onChange={(e) => {
                            manualAreaChoiceClientRef.current = clientId;
                            setArea(e.target.value);
                          }}
                          aria-describedby={getLabelMessage("areaId")?.id}
                        >
                          <option value="">선택하세요</option>
                          {(areaTemplates ?? []).map((tpl) => (
                            <option key={tpl.areaId} value={tpl.areaId}>
                              {getAreaTemplateDisplayLabel(tpl.areaId, tpl.templateName)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </ContractFormField>
                  </div>
                </>
              ) : null}

              {activeStep === 1 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-card-title">
                      제공인력 1<span className={styles.requiredMark}>*</span>
                      {primaryEmployeeMessage ? (
                        <span className={styles.formCardTitleMessage}>
                          <ContractFieldLabelMessage dataComponent="mobile_contracts-new_employee_primary" message={primaryEmployeeMessage} />
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.formRow} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field">
                      <EmployeeAutocomplete
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field_primary-autocomplete"
                        value={employeeId}
                        onChange={handleEmployeeSelect}
                        label=""
                        excludeIds={employee2Id != null ? [employee2Id] : []}
                        placeholder={registeredSnapshot?.primaryEmployeeId.display ?? undefined}
                      />
                    </div>
                    <ContractFormField dataComponent="mobile_contracts-new_employee_primary-phone-field" label="연락처" required>
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-phone-input"
                        className={styles.formInput}
                        value={formatPhoneNumber(employeePhone)}
                        type="tel"
                        inputMode="numeric"
                        maxLength={13}
                        placeholder="010-1234-5678"
                        readOnly
                      />
                    </ContractFormField>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card">
                    <div
                      className={styles.toggleRow}
                      data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row"
                      onClick={() => handleEmployee2VisibilityChange(!showEmployee2)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className={styles.toggleText} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row_secondary-toggle-copy">
                        <div className={styles.toggleLabel} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row_secondary-toggle-copy_secondary-toggle-label">
                          제공인력 2 추가
                        </div>
                      </div>
                      <Switch
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-toggle-row_secondary-toggle"
                        aria-label="제공인력 2 토글"
                        checked={showEmployee2}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={handleEmployee2VisibilityChange}
                      />
                    </div>
                    {showEmployee2 ? (
                      <>
                        <div className={styles.dashedDivider} />
                        <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-card-title">
                          제공인력 2<span className={styles.requiredMark}>*</span>
                          {secondaryEmployeeMessage ? (
                            <span className={styles.formCardTitleMessage}>
                              <ContractFieldLabelMessage dataComponent="mobile_contracts-new_employee_secondary" message={secondaryEmployeeMessage} />
                            </span>
                          ) : null}
                        </div>
                        <div className={styles.formRow} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field">
                          <EmployeeAutocomplete
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field_secondary-autocomplete"
                            value={employee2Id}
                            onChange={handleEmployee2Select}
                            label=""
                            excludeIds={employeeId != null ? [employeeId] : []}
                            placeholder={registeredSnapshot?.secondaryEmployeeId.display ?? undefined}
                          />
                        </div>
                        <ContractFormField dataComponent="mobile_contracts-new_employee_secondary-phone-field" label="연락처" required>
                          <input
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-phone-input"
                            className={styles.formInput}
                            value={formatPhoneNumber(employee2Phone)}
                            type="tel"
                            inputMode="numeric"
                            maxLength={13}
                            placeholder="010-1234-5678"
                            readOnly
                          />
                        </ContractFormField>
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}

              {activeStep === 2 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_selection-card-title">
                      바우처 선택
                    </div>
                    <div className={styles.formGrid2}>
                      <ContractFormField dataComponent="mobile_contracts-new_voucher_year-field" label="연도" required>
                        <div className={styles.selectWrap}>
                          <select
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_year-select"
                            className={styles.formInput}
                            value={voucherYear || ""}
                            onChange={(e) => setVoucherYear(Number(e.target.value))}
                          >
                            <option value="">선택</option>
                            {(voucherYears ?? []).map((y) => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                        </div>
                      </ContractFormField>
                      <ContractFormField
                        dataComponent="mobile_contracts-new_voucher_type-field"
                        label="바우처 유형"
                        required
                        message={getLabelMessage("type")}
                      >
                        <div className={styles.selectWrap}>
                          <select
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_type-select"
                            className={styles.formInput}
                            value={voucherType}
                            onChange={(e) => handleVoucherTypeChange(e.target.value)}
                            aria-describedby={getLabelMessage("type")?.id}
                          >
                            <option value="">선택하세요</option>
                            {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                              <optgroup key={groupName} label={groupName}>
                                {Object.entries(types).map(([typeValue, typeData]) => (
                                  <option key={typeValue} value={typeValue}>
                                    {typeData.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </ContractFormField>
                    </div>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_voucher_duration-field"
                      label="기간"
                      required
                      message={getLabelMessage("duration")}
                    >
                      <div className={cn(styles.selectWrap, isPriceLoading ? styles.loadingSelect : !voucherType && styles.disabledSelect)}>
                        <select
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_duration-select"
                          className={styles.formInput}
                          value={voucherDuration}
                          onChange={(e) => handleDurationChange(e.target.value)}
                          disabled={!voucherType || isPriceLoading}
                          aria-describedby={getLabelMessage("duration")?.id}
                        >
                          <option value="">선택하세요</option>
                          {availableDurations.map((d) => (
                            <option key={d} value={d}>{d}일</option>
                          ))}
                        </select>
                      </div>
                    </ContractFormField>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_price-card-title">
                      요금 정보
                      {selectedPriceInfo && !pricesManuallyEdited ? (
                        <span className={styles.autoBadge}>자동입력</span>
                      ) : null}
                    </div>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_voucher_full-price-field"
                      label="총 서비스 금액"
                      required
                      message={getLabelMessage("fullPrice")}
                    >
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_full-price-input"
                          className={styles.formInput}
                          value={formatPrice(fullPrice)}
                          onChange={(e) => handlePriceChange("fullPrice", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder={registeredPlaceholder("fullPrice", "0", formatPrice)}
                          aria-describedby={getLabelMessage("fullPrice")?.id}
                        />
                        <span>원</span>
                      </div>
                    </ContractFormField>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_voucher_grant-field"
                      label="정부지원금"
                      required
                      message={getLabelMessage("grant")}
                    >
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_grant-input"
                          className={styles.formInput}
                          value={formatPrice(grant)}
                          onChange={(e) => handlePriceChange("grant", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder={registeredPlaceholder("grant", "0", formatPrice)}
                          aria-describedby={getLabelMessage("grant")?.id}
                        />
                        <span>원</span>
                      </div>
                    </ContractFormField>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_voucher_actual-price-field"
                      label="본인부담금"
                      required
                      message={getLabelMessage("actualPrice")}
                    >
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_actual-price-input"
                          className={styles.formInput}
                          value={formatPrice(actualPrice)}
                          onChange={(e) => handlePriceChange("actualPrice", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder={registeredPlaceholder("actualPrice", "0", formatPrice)}
                          aria-describedby={getLabelMessage("actualPrice")?.id}
                        />
                        <span>원</span>
                      </div>
                    </ContractFormField>
                  </div>
                </>
              ) : null}

              {activeStep === 3 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_period-card-title">
                      서비스 기간
                    </div>
                    <CalendarLoadNotice
                      error={calendarError ?? (endDateUnsupported ? "unsupported-year" : null)}
                      onRetry={retryCalendar}
                      loading={!calendarReady && !calendarError}
                      dataComponent="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_calendar-notice"
                    />
                    <ContractFormField
                      dataComponent="mobile_contracts-new_review_start-date-field"
                      label="시작일"
                      htmlFor={CONTRACT_START_DATE_INPUT_ID}
                      required
                      message={startDateMessage}
                    >
                      <input
                        id={CONTRACT_START_DATE_INPUT_ID}
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_start-date-input"
                        className={styles.formInput}
                        value={startDateInput}
                        onChange={(e) => {
                          fieldInteractions.onChange("startDate", startDateInput, formatIsoDateInput(e.target.value));
                          handleDateInputChange(setStartDateInput, setStartDate, e.target.value);
                        }}
                        onFocus={() => fieldInteractions.onFocus("startDate")}
                        onBlur={(e) => fieldInteractions.onBlur("startDate", e.currentTarget.value)}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder={registeredPlaceholder("startDate", START_DATE_PLACEHOLDER)}
                        aria-invalid={startDateFieldMessage?.slot === "field-error-message" ? "true" : undefined}
                        aria-describedby={startDateMessage?.id}
                      />
                    </ContractFormField>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_review_end-date-field"
                      label="종료일"
                      htmlFor={CONTRACT_END_DATE_INPUT_ID}
                      required
                      message={endDateMessage}
                    >
                      <input
                        id={CONTRACT_END_DATE_INPUT_ID}
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_end-date-input"
                        className={styles.formInput}
                        value={endDateInput}
                        onChange={(e) => {
                          // A manual end date wins over a calculation that was waiting for the calendar.
                          endDateCalcSkippedRef.current = false;
                          setEndDateUnsupported(false);
                          fieldInteractions.onChange("endDate", endDateInput, formatIsoDateInput(e.target.value));
                          handleDateInputChange(setEndDateInput, setEndDate, e.target.value);
                        }}
                        onFocus={() => fieldInteractions.onFocus("endDate")}
                        onBlur={(e) => fieldInteractions.onBlur("endDate", e.currentTarget.value)}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder={registeredPlaceholder("endDate", END_DATE_PLACEHOLDER)}
                        aria-invalid={endDateFieldMessage?.slot === "field-error-message" ? "true" : undefined}
                        aria-describedby={endDateMessage?.id}
                      />
                    </ContractFormField>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card_payment-card-title">
                      결제 정보
                    </div>
                    <ContractFormField
                      dataComponent="mobile_contracts-new_review_payment-date-field"
                      label="본인부담금 수령 날짜"
                      htmlFor={CONTRACT_PAYMENT_DATE_INPUT_ID}
                      required
                      message={paymentDateMessage}
                    >
                      <input
                        id={CONTRACT_PAYMENT_DATE_INPUT_ID}
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card_payment-date-input"
                        className={styles.formInput}
                        value={effectivePaymentDateInput}
                        onChange={(e) => {
                          fieldInteractions.onChange("paymentDate", effectivePaymentDateInput, formatIsoDateInput(e.target.value));
                          handleDateInputChange(setPaymentDateInput, setPaymentDate, e.target.value, true);
                        }}
                        onFocus={() => fieldInteractions.onFocus("paymentDate")}
                        onBlur={(e) => fieldInteractions.onBlur("paymentDate", e.currentTarget.value)}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder={PAYMENT_DATE_PLACEHOLDER}
                        aria-invalid={paymentDateFieldMessage?.slot === "field-error-message" ? "true" : undefined}
                        aria-describedby={paymentDateMessage?.id}
                      />
                    </ContractFormField>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_summary-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_summary-card_summary-card-title">
                      최종 확인
                    </div>
                    <div className={styles.priceSummary} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_summary-card_summary-list">
                      <div className={styles.priceSummaryRow}>
                        <span>고객</span>
                        <span className={styles.amount}>{name || "-"}</span>
                      </div>
                      <div className={styles.priceSummaryRow}>
                        <span>제공인력</span>
                        <span className={styles.amount}>{employeeName || "-"}</span>
                      </div>
                      <div className={styles.priceSummaryRow}>
                        <span>바우처</span>
                        <span className={styles.amount}>
                          {voucherType ? `${voucherType} · ${voucherDuration}일` : "-"}
                        </span>
                      </div>
                      <div className={styles.priceSummaryRow}>
                        <span>기간</span>
                        <span className={styles.amount}>
                          {effectiveStartDate && effectiveEndDate
                            ? `${dayjs(effectiveStartDate).format("YYYY.MM.DD")} → ${dayjs(effectiveEndDate).format("YYYY.MM.DD")}`
                            : "-"}
                        </span>
                      </div>
                      <div className={cn(styles.priceSummaryRow, styles.total)}>
                        <span>본인부담금</span>
                        <span className={styles.amount}>{actualPrice ? `${formatPrice(actualPrice)} 원` : "-"}</span>
                      </div>
                    </div>
                  </div>

                </>
              ) : null}
            </div>

            <div className={styles.wizardActions} data-component="mobile_contracts-new_screen_root_page_root_actions">
              <button
                data-component="mobile_contracts-new_screen_root_page_root_actions_previous-button"
                type="button"
                onClick={handlePrev}
                disabled={isFirstStep}
                className={cn(styles.wizardButton, styles.secondaryButton)}
              >
                이전
              </button>
              <button
                data-component="mobile_contracts-new_screen_root_page_root_actions_next-button"
                type="button"
                onClick={handleNext}
                disabled={isPrimaryDisabled}
                className={cn(styles.wizardButton, styles.primaryButton)}
              >
                {isBusy ? "생성 중..." : isLastStep ? "계약서 생성" : "다음"}
              </button>
            </div>
          </section>
        </div>
      </div>

      <HeadlessProgressModal
        open={isProgressModalOpen}
        title="전자문서 생성 중"
        steps={CONTRACT_CREATION_PROGRESS_STEPS}
        progress={creationProgress}
        errorHint={progressErrorHint}
        data-component="mobile_contracts-new_progress_modal"
      />

      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_submit-modal"
        open={confirmationMessage !== null}
        title="계약서 생성 확인"
        description={confirmationMessage ?? ""}
        cancelLabel="취소"
        confirmLabel="확인"
        confirmVariant="default"
        actionOrder="cancel-confirm"
        onOpenChange={(open) => {
          if (!open) resolveConfirmation(false);
        }}
        onCancel={() => resolveConfirmation(false)}
        onConfirm={() => resolveConfirmation(true)}
      />

      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_client-diff-modal"
        open={clientDiffPrompt !== null}
        title="고객 정보와 다른 내용이 있어요"
        description="계약서에 입력한 내용이 저장된 고객 정보와 달라요. 고객 정보도 함께 수정할까요?"
        cancelLabel="계약서에만 반영"
        confirmLabel="고객 정보도 수정"
        confirmVariant="default"
        actionOrder="cancel-confirm"
        onOpenChange={(open) => {
          if (!open) resolveClientDiffDecision("cancel");
        }}
        onCancel={() => resolveClientDiffDecision("contract-only")}
        onConfirm={() => resolveClientDiffDecision("update-client")}
      >
        <ul
          className={styles.clientDiffList}
          data-component="mobile_contracts-new_confirmation_client-diff-modal_list"
        >
          {clientDiffPrompt?.rows.map((row) => (
            <li
              key={row.key}
              className={styles.clientDiffRow}
              data-component="mobile_contracts-new_confirmation_client-diff-modal_row"
            >
              <span className={styles.clientDiffLabel}>{row.label}</span>
              <span className={styles.clientDiffValue}>
                <del className={styles.clientDiffOld}>{row.oldDisplay}</del>
                {" → "}
                <strong className={styles.clientDiffNew}>{row.newDisplay}</strong>
              </span>
            </li>
          ))}
        </ul>
        {clientDiffPrompt?.showPeriodLockedNote ? (
          <p
            className={styles.clientDiffNote}
            data-component="mobile_contracts-new_confirmation_client-diff-modal_period-locked-note"
          >
            {CLIENT_DIFF_PERIOD_LOCKED_NOTE}
          </p>
        ) : null}
      </MobileTwoButtonModal>

      <MobileTwoButtonModal
        data-component="mobile_contracts-new_confirmation_existing-contract-modal"
        open={isExistingContractConfirmOpen}
        title="계약서 재생성 확인"
        description="이전에 전송된 계약서가 있습니다. 그래도 새로 생성하시겠어요?"
        cancelLabel="취소"
        confirmLabel="생성"
        confirmVariant="default"
        actionOrder="cancel-confirm"
        loading={isBusy}
        onOpenChange={(open) => {
          if (!isBusy) setIsExistingContractConfirmOpen(open);
        }}
        onCancel={() => setIsExistingContractConfirmOpen(false)}
        onConfirm={() => {
          setIsExistingContractConfirmOpen(false);
          void handleSubmit();
        }}
      />

      {isEformsignModalOpen ? (
        <div className={styles.eformsignModal} data-component="mobile_contracts-new_signing_modal">
          <div className={styles.eformsignModalHeader} data-component="mobile_contracts-new_signing_modal_header">
            <span data-component="mobile_contracts-new_signing_modal_header_title">계약서 서명</span>
            <button
              data-component="mobile_contracts-new_signing_modal_header_close-button"
              type="button"
              onClick={handleEformsignModalClose}
              className={styles.navbarIconButton}
              aria-label="닫기"
            >
              <X aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
          </div>
          <iframe
            id="eformsign_iframe"
            className={styles.eformsignIframe}
            data-component="mobile_contracts-new_signing_modal_iframe"
            title="eformsign"
          />
        </div>
      ) : null}

    </>
  );
}
