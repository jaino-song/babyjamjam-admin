"use client";
import {
  getUserErrorMessage,
  normalizeApiError,
  type ProblemOutcome,
} from "@babyjamjam/shared";


import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import dayjs from "dayjs";
import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";

import { useFormStore } from "@/stores/form-store";
import { useEformsign } from "@/hooks/useEformsign";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import { toast } from "@/hooks/use-toast";
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
import { isStrictIsoDate, isoToYymmdd, normalizeIsoDate, todayIsoDate, yymmddToIso } from "@/lib/contracts/date-input";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
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
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildContractSubmissionAlert,
  canUseContractIframeFallback,
  CONTRACT_OUTCOME_COPY,
  focusContractValidationErrors,
  isHeadlessSuccessResponse,
  isRecord,
  isSafeClientId,
  isValidIframeSuccessResponse,
  type ContractSubmissionAlert,
} from "./page.helpers";
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
const AREA_TEMPLATE_DISPLAY_LABELS: Record<string, string> = {
  Namdonggu: "남동구",
  Seogu: "서구",
};

type HelperTone = "muted" | "ok" | "err" | "pending";

function getAreaTemplateDisplayLabel(areaId: string, templateName?: string | null): string {
  const mappedLabel = AREA_TEMPLATE_DISPLAY_LABELS[areaId];
  if (mappedLabel) return mappedLabel;

  return templateName?.replace(/\s*계약서.*$/, "").trim() || areaId;
}

function Field({
  dataComponent,
  label,
  required,
  children,
  helper,
  helperTone = "muted",
}: {
  dataComponent: string;
  label: ReactNode;
  required?: boolean;
  children: ReactNode;
  helper?: ReactNode;
  helperTone?: HelperTone;
}) {
  return (
    <div className={styles.formRow} data-component={dataComponent}>
      <label className={styles.formLabel} data-component={`${dataComponent}_label`}>
        {label}
        {required ? (
          <span className={styles.requiredMark} data-component={`${dataComponent}_required`}>*</span>
        ) : null}
      </label>
      {children}
      {helper ? (
        <div
          className={cn(styles.formHelper, styles[`helper_${helperTone}`])}
          data-component={`${dataComponent}_helper`}
        >
          {helper}
        </div>
      ) : null}
    </div>
  );
}

const formatPhoneNumber = formatKoreanPhoneNumber;

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

const normalizeBirthdayInput = (value: string | null | undefined): string => {
  if (!value) return "";

  const isoValue = isoToYymmdd(value);
  if (isoValue) return isoValue;

  const digits = value.replace(/\D/g, "");
  if (digits.length === 6) return digits;
  if (digits.length === 8) return digits.slice(2);
  return digits.slice(0, 6);
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
    showEmployee2, employee2Id, employee2Phone,
    voucherType, voucherDuration, voucherYear,
    fullPrice, grant, actualPrice,
    startDate, endDate, paymentDate,
    preservePrefilledPrices,
    setClientId, setIsManualEntry, setName, setPhone, setBirthday, setAddress, setDueDate, setArea,
    setIsEmployeeManualEntry, setEmployeeSelection,
    setShowEmployee2, setIsEmployee2ManualEntry, setEmployee2Selection,
    setVoucherType, setVoucherDuration, setVoucherYear,
    setFullPrice, setGrant, setActualPrice,
    setStartDate, setEndDate, setPaymentDate,
    setPreservePrefilledPrices,
  } = useFormStore();

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
  const [creationProgress, setCreationProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [progressErrorHint, setProgressErrorHint] = useState<string | null>(null);
  const progressSourceRef = useRef<EventSource | null>(null);
  const selectedClientRef = useRef<Pick<Client, "id" | "name"> | null>(null);
  const defaultPaymentDate = useMemo(() => todayIsoDate(), []);
  const hasAppliedPaymentStepDefaultRef = useRef(false);

  // Local YYMMDD drafts so partial input doesn't trash the ISO store value
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");
  const isContractInfoStep = activeStep === WIZARD_STEPS.length - 1;
  const normalizedPaymentDate = normalizeIsoDate(paymentDate);
  const fallbackPaymentDate = normalizedPaymentDate || defaultPaymentDate;
  const shouldUseFallbackPaymentDate = isContractInfoStep && paymentDateInput.length === 0;
  const effectivePaymentDate = shouldUseFallbackPaymentDate ? fallbackPaymentDate : paymentDate;
  const effectivePaymentDateInput = shouldUseFallbackPaymentDate ? isoToYymmdd(fallbackPaymentDate) : paymentDateInput;

  useEffect(() => {
    if (!isContractInfoStep) {
      hasAppliedPaymentStepDefaultRef.current = false;
      return;
    }

    if (hasAppliedPaymentStepDefaultRef.current) return;
    hasAppliedPaymentStepDefaultRef.current = true;
    if (!normalizedPaymentDate) setPaymentDate(defaultPaymentDate);
  }, [defaultPaymentDate, isContractInfoStep, normalizedPaymentDate, setPaymentDate]);
  useEffect(() => { setStartDateInput(isoToYymmdd(startDate)); }, [startDate]);
  useEffect(() => { setEndDateInput(isoToYymmdd(endDate)); }, [endDate]);
  useEffect(() => { setPaymentDateInput(isoToYymmdd(paymentDate)); }, [paymentDate]);
  useEffect(() => {
    setArea("");
  }, [setArea]);
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
  ) => {
    const v = raw.replace(/\D/g, "").slice(0, 6);
    setLocal(v);
    if (v.length === 6) setStore(yymmddToIso(v));
    else if (v.length === 0) setStore("");
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

  // Business-day end date auto-calc from startDate + duration
  useEffect(() => {
    if (!startDate || !voucherDuration) return;
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const endIso = calcEndDateBusinessDays(startDate, n);
    if (endIso) setEndDate(endIso);
  }, [startDate, voucherDuration, setEndDate]);

  const showErrorToast = (message: string) => {
    toast({ variant: "destructive", description: getUserErrorMessage(message) });
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

  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
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
      setArea("");
      if (client.type) setVoucherType(client.type);
      if (client.duration) setVoucherDuration(client.duration.toString());
      if (client.fullPrice) setFullPrice(client.fullPrice);
      if (client.grant) setGrant(client.grant);
      if (client.actualPrice) setActualPrice(client.actualPrice);
      if (client.startDate) {
        const startNorm = normalizeIsoDate(client.startDate);
        setStartDate(startNorm);
        setPaymentDate(defaultPaymentDate);
      }
      if (client.endDate) setEndDate(normalizeIsoDate(client.endDate));
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
      setStartDate(""); setEndDate(""); setPaymentDate(defaultPaymentDate);
      setArea("");
      setEmployeeSelection(null, "", "");
      setEmployee2Selection(null, "", "");
      setShowEmployee2(false);
    }
    setPricesManuallyEdited(false);
  };

  const handleClientNameInputChange = (nextName: string) => {
    const isNameChanging = nextName !== name;
    setName(nextName);
    const matchesSelectedClient = clientId !== null && selectedClientRef.current?.name === nextName;
    const hasSelectedClientSnapshot = clientId !== null && selectedClientRef.current !== null;
    const willClearSelectedClient = hasSelectedClientSnapshot && !matchesSelectedClient;
    if (willClearSelectedClient) {
      setClientId(null);
      selectedClientRef.current = null;
      setArea("");
    } else if (isNameChanging && clientId === null && area) {
      setArea("");
    }
    setIsManualEntry(Boolean(nextName.trim()) && !matchesSelectedClient && (clientId === null || willClearSelectedClient));
  };

  const handleClientManualEntry = (query: string) => {
    setClientId(null);
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


  const isStep1Valid = Boolean(
    !clientsDataUnavailable &&
    (clientId !== null || (isManualEntry && name.trim() && phone.trim())) && area
  );
  const isEmployee1Valid = employeeId !== null;
  const isEmployee2Valid = !showEmployee2 || employee2Id !== null;
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  const isStep4Valid = Boolean(
    startDate && isStrictIsoDate(startDate) &&
    endDate && isStrictIsoDate(endDate) &&
    effectivePaymentDate && isStrictIsoDate(effectivePaymentDate)
  );
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid][activeStep] ?? true;

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
      let finalClientId = clientId ?? storedClientByIdentity?.id ?? storedClientByPhone?.id ?? null;
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
        dueDate: dueDate || startDate || undefined,
        type: voucherType || null,
        duration: Number(voucherDuration) || null,
        fullPrice: fullPrice || null,
        grant: grant || null,
        actualPrice: actualPrice || null,
        startDate: startDate || null,
        endDate: endDate || null,
        areaId: area || null,
      };
      if (!finalClientId && isManualEntry) {
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
          if (!isAxiosError<{ message?: string; error?: string; clientId?: number }>(error) || error.response?.status !== 409) {
            showSubmissionFailure(error, "UNKNOWN");
            return;
          }
          const conflict = error.response.data;
          if (!conflict.clientId) {
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
      if (clientId !== null || storedClientByIdentity || storedClientByPhone) {
        try {
          await updateClientMutation.mutateAsync({
            id: finalClientId,
            dto: clientData,
          });
        } catch (error) {
          showSubmissionFailure(error, "UNKNOWN");
          return;
        }
      }

      // Provider identity remains server-owned; this page sends only contract data.
      // 2. Build contract data for the server-mediated dispatch operation.
      const start = dayjs(startDate);
      const end = dayjs(endDate);
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
        startYear: start.format("YY"), startMonth: start.format("MM"), startDay: start.format("DD"), startDate,
        endYear: end.format("YY"), endMonth: end.format("MM"), endDay: end.format("DD"), endDate,
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
        progressSource = new EventSource(
          `/api/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
        );
        progressSourceRef.current = progressSource;
        progressSource.addEventListener("progress", (event) => {
          let data: HeadlessProgressEvent;
          try { data = JSON.parse((event as MessageEvent).data) as HeadlessProgressEvent; }
          catch { return; }
          if (data.step === "failed") {
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

        const remoteDocumentId = typeof headless.remoteDocumentId === "string"
          && headless.remoteDocumentId.trim().length > 0
          ? headless.remoteDocumentId
          : null;
        if (headless.reason === "local_persist_failed" && remoteDocumentId) {
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
  const isPrimaryDisabled = isBusy || Boolean(submissionLock) || !isCurrentStepValid;

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
                    <Field dataComponent="mobile_contracts-new_client_name-field" label="이름" required>
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
                    </Field>
                    <Field dataComponent="mobile_contracts-new_client_phone-field" label="연락처" required>
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_phone-input"
                        className={styles.formInput}
                        value={phone}
                        onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                        type="tel"
                        inputMode="numeric"
                        maxLength={13}
                        placeholder="010-1234-5678"
                      />
                    </Field>
                    <div className={styles.formGrid2}>
                      <Field dataComponent="mobile_contracts-new_client_birthday-field" label="생년월일">
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_birthday-input"
                          className={styles.formInput}
                          value={birthday}
                          onChange={(e) => setBirthday(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                      <Field dataComponent="mobile_contracts-new_client_start-date-field" label="서비스 시작일">
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_start-date-input"
                          className={styles.formInput}
                          value={startDateInput}
                          onChange={(e) => handleDateInputChange(setStartDateInput, setStartDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                    </div>
                    <Field dataComponent="mobile_contracts-new_client_address-field" label="주소">
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_card_address-input"
                        className={styles.formInput}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="서울시 강남구..."
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_area-card">
                    <Field dataComponent="mobile_contracts-new_client_area-field" label="계약서 유형" required>
                      <div className={styles.selectWrap}>
                        <select
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_area-card_area-select"
                          className={styles.formInput}
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                        >
                          <option value="">선택하세요</option>
                          {(areaTemplates ?? []).map((tpl) => (
                            <option key={tpl.areaId} value={tpl.areaId}>
                              {getAreaTemplateDisplayLabel(tpl.areaId, tpl.templateName)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </Field>
                  </div>
                </>
              ) : null}

              {activeStep === 1 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-card-title">
                      제공인력 1<span className={styles.requiredMark}>*</span>
                    </div>
                    <div className={styles.formRow} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field">
                      <EmployeeAutocomplete
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-autocomplete-field_primary-autocomplete"
                        value={employeeId}
                        onChange={handleEmployeeSelect}
                        label=""
                        excludeIds={employee2Id != null ? [employee2Id] : []}
                      />
                    </div>
                    <Field dataComponent="mobile_contracts-new_employee_primary-phone-field" label="연락처" required>
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_primary-card_primary-phone-input"
                        className={styles.formInput}
                        value={employeePhone}
                        type="tel"
                        inputMode="numeric"
                        maxLength={13}
                        placeholder="010-1234-5678"
                        readOnly
                      />
                    </Field>
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
                        </div>
                        <div className={styles.formRow} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field">
                          <EmployeeAutocomplete
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-autocomplete-field_secondary-autocomplete"
                            value={employee2Id}
                            onChange={handleEmployee2Select}
                            label=""
                            excludeIds={employeeId != null ? [employeeId] : []}
                          />
                        </div>
                        <Field dataComponent="mobile_contracts-new_employee_secondary-phone-field" label="연락처" required>
                          <input
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_secondary-card_secondary-phone-input"
                            className={styles.formInput}
                            value={employee2Phone}
                            type="tel"
                            inputMode="numeric"
                            maxLength={13}
                            placeholder="010-1234-5678"
                            readOnly
                          />
                        </Field>
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
                      <Field dataComponent="mobile_contracts-new_voucher_year-field" label="연도" required>
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
                      </Field>
                      <Field dataComponent="mobile_contracts-new_voucher_type-field" label="바우처 유형" required>
                        <div className={styles.selectWrap}>
                          <select
                            data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_type-select"
                            className={styles.formInput}
                            value={voucherType}
                            onChange={(e) => handleVoucherTypeChange(e.target.value)}
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
                      </Field>
                    </div>
                    <Field dataComponent="mobile_contracts-new_voucher_duration-field" label="기간" required>
                      <div className={cn(styles.selectWrap, isPriceLoading ? styles.loadingSelect : !voucherType && styles.disabledSelect)}>
                        <select
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_duration-select"
                          className={styles.formInput}
                          value={voucherDuration}
                          onChange={(e) => handleDurationChange(e.target.value)}
                          disabled={!voucherType || isPriceLoading}
                        >
                          <option value="">선택하세요</option>
                          {availableDurations.map((d) => (
                            <option key={d} value={d}>{d}일</option>
                          ))}
                        </select>
                      </div>
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_price-card-title">
                      요금 정보
                      {selectedPriceInfo && !pricesManuallyEdited ? (
                        <span className={styles.autoBadge}>자동입력</span>
                      ) : null}
                    </div>
                    <Field dataComponent="mobile_contracts-new_voucher_full-price-field" label="총 서비스 금액" required>
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_full-price-input"
                          className={styles.formInput}
                          value={formatPrice(fullPrice)}
                          onChange={(e) => handlePriceChange("fullPrice", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field dataComponent="mobile_contracts-new_voucher_grant-field" label="정부지원금" required>
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_grant-input"
                          className={styles.formInput}
                          value={formatPrice(grant)}
                          onChange={(e) => handlePriceChange("grant", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field dataComponent="mobile_contracts-new_voucher_actual-price-field" label="본인부담금" required>
                      <div className={styles.priceInput}>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_price-card_actual-price-input"
                          className={styles.formInput}
                          value={formatPrice(actualPrice)}
                          onChange={(e) => handlePriceChange("actualPrice", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                  </div>
                </>
              ) : null}

              {activeStep === 3 ? (
                <>
                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_period-card-title">
                      서비스 기간
                    </div>
                    <div className={styles.formGrid2}>
                      <Field dataComponent="mobile_contracts-new_review_start-date-field" label="시작일" required>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_start-date-input"
                          className={styles.formInput}
                          value={startDateInput}
                          onChange={(e) => handleDateInputChange(setStartDateInput, setStartDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                      <Field dataComponent="mobile_contracts-new_review_end-date-field" label="종료일" required>
                        <input
                          data-component="mobile_contracts-new_screen_root_page_root_form-scroll_period-card_end-date-input"
                          className={styles.formInput}
                          value={endDateInput}
                          onChange={(e) => handleDateInputChange(setEndDateInput, setEndDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                    </div>
                    <div className={styles.formHelper}>
                      시작일 + 바우처 기간으로 종료일이 자동 계산됩니다 (주말·공휴일 제외).
                    </div>
                  </div>

                  <div className={styles.formCard} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card">
                    <div className={styles.formCardTitle} data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card_payment-card-title">
                      결제 정보
                    </div>
                    <Field dataComponent="mobile_contracts-new_review_payment-date-field" label="본인부담금 수령 날짜" required>
                      <input
                        data-component="mobile_contracts-new_screen_root_page_root_form-scroll_payment-card_payment-date-input"
                        className={styles.formInput}
                        value={effectivePaymentDateInput}
                        onChange={(e) => handleDateInputChange(setPaymentDateInput, setPaymentDate, e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                      />
                    </Field>
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
                          {startDate && endDate
                            ? `${dayjs(startDate).format("YYYY.MM.DD")} → ${dayjs(endDate).format("YYYY.MM.DD")}`
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
