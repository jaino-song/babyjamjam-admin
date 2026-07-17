"use client";

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useClient, useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useNavigationPending } from "@/hooks/use-navigation-pending";
import {
  useAllVoucherPrices,
  useBankAccountInfos,
  useVoucherPriceInfos,
  type BankAccountInfo,
  type VoucherPriceInfo,
} from "@/hooks/useVoucherData";
import type { CreateClientDto, ServiceStatus, UpdateClientDto } from "@/lib/client/types";
import { SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { api } from "@/lib/api/client";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { useEmployees, type Employee } from "@/hooks/useEmployees";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import bankAccountOptions from "@/components/app/messages/templates/json/bank-account.json";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { parsePositiveIntQueryParam } from "@/lib/query-params";
import { buildClientEditPrefillFromEformsignDocument } from "@/lib/eformsign/client-prefill";
import { eformsignApi, withEformsignReauth } from "@/services/api";
import { cn } from "@/lib/utils";
import styles from "./page.module.css";

const PHONE_DUPLICATE_CHECK_MAX_RETRIES = 3;
const PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS = 1000;
const PHONE_DUPLICATE_CHECK_FAILED_MESSAGE = "문제가 발생했어요. 새로고침 해주세요.";

const WIZARD_STEPS = [
  { title: "기본 정보", desc: "고객님의 기본 정보를 입력해주세요." },
  { title: "서비스 설정", desc: "바우처와 제공인력, 요금 정보를 확인해주세요." },
  { title: "계약 정보", desc: "계약 상태와 서비스 기간을 입력해주세요." },
] as const;
const VOUCHER_TYPE_OPTIONS = Object.values(voucherOptions.voucherOptions).flatMap((types) =>
  Object.entries(types).map(([value, typeData]) => ({
    value,
    label: typeData.label,
  })),
);

const getBankAccountAreaLabel = (areaId: string): string => (
  bankAccountOptions[areaId as keyof typeof bankAccountOptions]?.area ?? areaId
);

const getBankAccountOptionLabel = (account: BankAccountInfo): string => {
  const areaLabel = getBankAccountAreaLabel(account.area);
  const accountText = [account.bankName, account.accNum].filter(Boolean).join(" ");

  return accountText ? `${areaLabel} · ${accountText}` : areaLabel;
};

type HelperTone = "muted" | "ok" | "err" | "pending";

function Field({
  label,
  required,
  children,
  helper,
  helperTone = "muted",
  helperPlacement = "below",
}: {
  label: ReactNode;
  required?: boolean;
  children: ReactNode;
  helper?: ReactNode;
  helperTone?: HelperTone;
  helperPlacement?: "label" | "below";
}) {
  const helperNode = helper ? (
    <div
      className={cn(
        styles.formHelper,
        helperPlacement === "label" ? styles.formHelperInline : null,
        styles[`helper_${helperTone}`],
      )}
      data-component="clients-new-form-helper"
    >
      {helper}
    </div>
  ) : null;

  return (
    <div className={styles.formRow} data-component="clients-new-form-row">
      <div className={styles.formFieldHeader} data-component="clients-new-form-field-header">
        <label className={styles.formLabel}>
          {label}
          {required ? <span className={styles.requiredMark}>*</span> : null}
        </label>
        {helperPlacement === "label" ? helperNode : null}
      </div>
      {children}
      {helperPlacement === "below" ? helperNode : null}
    </div>
  );
}

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
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

const yymmddToIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const v = value.trim();
  if (!/^\d{6}$/.test(v)) return v;
  return `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}`;
};

// ISO "2026-05-30" → "260530" — 편집 모드에서 client 데이터를 wizard store(YYMMDD)에 하이드레이트.
const isoToYymmdd = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
};

const normalizeOptionToken = (value: string): string => value.replace(/[\s_-]+/g, "").toLowerCase();

const resolveVoucherTypeValue = (value: string | null | undefined): string | undefined => {
  const normalized = normalizeOptionToken(value ?? "");
  if (!normalized) return undefined;

  return VOUCHER_TYPE_OPTIONS.find((option) => (
    normalizeOptionToken(option.value) === normalized ||
    normalizeOptionToken(option.label) === normalized
  ))?.value;
};

const normalizePhoneDigits = (value: string | null | undefined): string => (value ?? "").replace(/\D/g, "");

const findEmployeeByContractPrefill = (
  employees: readonly Employee[],
  name: string | undefined,
  phone: string | undefined,
): Employee | undefined => {
  if (!name) return undefined;
  const trimmedName = name.trim();
  const phoneDigits = normalizePhoneDigits(phone);

  return employees.find((employee) => {
    if (employee.name.trim() !== trimmedName) return false;
    return !phoneDigits || normalizePhoneDigits(employee.phone) === phoneDigits;
  }) ?? employees.find((employee) => employee.name.trim() === trimmedName);
};

const normalizePriceDigits = (value: string | null | undefined): string => (value ?? "").replace(/\D/g, "");

const findVoucherPriceByAmounts = (
  voucherPrices: readonly VoucherPriceInfo[],
  amounts: { fullPrice?: string; grant?: string; actualPrice?: string },
): VoucherPriceInfo | undefined => {
  const fullPrice = normalizePriceDigits(amounts.fullPrice);
  const grant = normalizePriceDigits(amounts.grant);
  const actualPrice = normalizePriceDigits(amounts.actualPrice);
  if (!fullPrice && !grant && !actualPrice) return undefined;

  return voucherPrices.find((price) => {
    if (fullPrice && normalizePriceDigits(price.fullPrice) !== fullPrice) return false;
    if (grant && normalizePriceDigits(price.grant) !== grant) return false;
    if (actualPrice && normalizePriceDigits(price.actualPrice) !== actualPrice) return false;
    return true;
  });
};

export default function NewClientPage() {
  const router = useRouter();
  const { isNavigationPending, startNavigation } = useNavigationPending();
  const searchParams = useSearchParams();
  const editingClientId = parsePositiveIntQueryParam(searchParams.get("clientId"));
  const isEditMode = editingClientId !== null;

  const locale = useLocale();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const { data: editingClient } = useClient(editingClientId ?? 0);
  const { data: employees = [], isLoading: isEmployeesLoading } = useEmployees();
  const voucherLookupYear = isEditMode ? new Date().getFullYear() : undefined;
  const {
    data: allVoucherPrices = [],
    isLoading: isAllVoucherPricesLoading,
    isFetching: isAllVoucherPricesFetching,
  } = useAllVoucherPrices(voucherLookupYear);
  const { data: bankAccountInfos = [], isLoading: isBankAccountInfosLoading } = useBankAccountInfos();
  const prefillName = useClientDialogStore((s) => s.prefillName);
  const prefillClient = useClientDialogStore((s) => s.prefillClient);
  const clearPrefillName = useClientDialogStore((s) => s.clearPrefillName);
  const clearPrefillClient = useClientDialogStore((s) => s.clearPrefillClient);

  const store = useClientWizardStore();
  const { currentStep, pricesManuallyEdited, setField, setCurrentStep, setPricesManuallyEdited, reset } = store;

  const [floatingError, setFloatingError] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);
  const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
  const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);
  const [hasPhoneDuplicateCheckFailed, setHasPhoneDuplicateCheckFailed] = useState(false);
  const [lastCheckedPhoneDigits, setLastCheckedPhoneDigits] = useState<string | null>(null);
  const floatingErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInitializedFormKeyRef = useRef<string | null>(null);
  const lastHydratedIdRef = useRef<number | null>(null);
  const lastHydratedContractDocIdRef = useRef<string | null>(null);

  const { data: editingContractDocument } = useQuery({
    queryKey: ["eformsign-docs", "document", editingClient?.eDocId],
    queryFn: async () => {
      const documentId = editingClient?.eDocId;
      if (!documentId) {
        throw new Error("documentId is required");
      }
      return withEformsignReauth(() => eformsignApi.getDocument(documentId));
    },
    enabled: Boolean(isEditMode && editingClient?.eDocId),
    staleTime: 1000 * 60,
    retry: 1,
  });

  const phoneDigits = useMemo(() => store.phone.replace(/\D/g, ""), [store.phone]);
  const originalPhoneDigits = useMemo(
    () => editingClient?.phone?.replace(/\D/g, "") ?? null,
    [editingClient?.phone],
  );
  const isUsingOriginalPhone = Boolean(isEditMode && originalPhoneDigits && phoneDigits === originalPhoneDigits);
  const isPhoneAvailable =
    phoneDigits.length === 11 &&
    (isUsingOriginalPhone ||
      (!isCheckingPhoneDuplicate &&
        !hasPhoneDuplicateCheckFailed &&
        !isPhoneDuplicate &&
        lastCheckedPhoneDigits === phoneDigits));
  const phoneInlineMessage = phoneDigits.length === 11
    ? isUsingOriginalPhone
      ? "✓ 등록 가능한 번호입니다."
      : isCheckingPhoneDuplicate
      ? "번호를 확인하고 있습니다."
      : hasPhoneDuplicateCheckFailed
        ? PHONE_DUPLICATE_CHECK_FAILED_MESSAGE
        : isPhoneDuplicate
          ? t(locale, "clients.form.error-phone-duplicate")
          : isPhoneAvailable
            ? "✓ 등록 가능한 번호입니다."
            : null
    : null;
  const phoneHelperTone: HelperTone = isUsingOriginalPhone
    ? "ok"
    : isCheckingPhoneDuplicate
      ? "pending"
      : hasPhoneDuplicateCheckFailed || isPhoneDuplicate
        ? "err"
        : isPhoneAvailable
          ? "ok"
          : "muted";

  const showFloatingError = (message: string) => {
    setFloatingError(message);
    if (floatingErrorTimeoutRef.current) {
      clearTimeout(floatingErrorTimeoutRef.current);
    }
    floatingErrorTimeoutRef.current = setTimeout(() => {
      setFloatingError(null);
      floatingErrorTimeoutRef.current = null;
    }, 5000);
  };

  useEffect(() => {
    return () => {
      if (floatingErrorTimeoutRef.current) {
        clearTimeout(floatingErrorTimeoutRef.current);
      }
    };
  }, []);

  const formSessionKey = isEditMode ? `edit:${editingClientId}` : "create";

  useEffect(() => {
    if (lastInitializedFormKeyRef.current === formSessionKey) return;
    lastInitializedFormKeyRef.current = formSessionKey;
    lastHydratedIdRef.current = null;
    lastHydratedContractDocIdRef.current = null;
    reset();
  }, [formSessionKey, reset]);

  useEffect(() => {
    if (!prefillName) return;

    if (isEditMode) {
      clearPrefillName();
      return;
    }

    setField("name", prefillName);
    clearPrefillName();
  }, [prefillName, clearPrefillName, isEditMode, setField]);

  useEffect(() => {
    if (!prefillClient) return;

    if (isEditMode) {
      clearPrefillClient();
      return;
    }

    reset();

    if (prefillClient.name !== undefined) setField("name", prefillClient.name);
    if (prefillClient.birthday !== undefined) setField("birthday", prefillClient.birthday);
    if (prefillClient.dueDate !== undefined) setField("dueDate", prefillClient.dueDate);
    if (prefillClient.address !== undefined) setField("address", prefillClient.address);
    if (prefillClient.phone !== undefined) setField("phone", prefillClient.phone);
    if (prefillClient.type !== undefined) setField("type", prefillClient.type);
    if (prefillClient.duration !== undefined) setField("duration", prefillClient.duration);
    if (prefillClient.fullPrice !== undefined) setField("fullPrice", prefillClient.fullPrice);
    if (prefillClient.grant !== undefined) setField("grant", prefillClient.grant);
    if (prefillClient.actualPrice !== undefined) setField("actualPrice", prefillClient.actualPrice);
    if (prefillClient.startDate !== undefined) setField("startDate", prefillClient.startDate);
    if (prefillClient.endDate !== undefined) setField("endDate", prefillClient.endDate);
    if (prefillClient.careCenter !== undefined) setField("careCenter", prefillClient.careCenter);
    if (prefillClient.voucherClient !== undefined) setField("voucherClient", prefillClient.voucherClient);
    if (prefillClient.breastPump !== undefined) setField("breastPump", prefillClient.breastPump);
    if (prefillClient.serviceStatus !== undefined) setField("serviceStatus", prefillClient.serviceStatus);
    if (prefillClient.areaId !== undefined) setField("areaId", prefillClient.areaId ?? "");

    if (
      prefillClient.fullPrice !== undefined ||
      prefillClient.grant !== undefined ||
      prefillClient.actualPrice !== undefined
    ) {
      setPricesManuallyEdited(true);
    }

    clearPrefillClient();
  }, [prefillClient, clearPrefillClient, isEditMode, reset, setField, setPricesManuallyEdited]);

  // 편집 모드: 기존 client 데이터를 wizard store에 1회 하이드레이트 (editingClient.id 변경 시 재실행).
  // pricesManuallyEdited=true 로 두어 voucherPriceInfos 자동 입력 effect가 저장된 요금을 덮어쓰지 못하게 한다.
  useEffect(() => {
    if (!editingClient) return;
    if (lastHydratedIdRef.current === editingClient.id) return;
    lastHydratedIdRef.current = editingClient.id;

    setField("name", editingClient.name);
    setField("birthday", editingClient.birthday ?? "");
    setField("dueDate", isoToYymmdd(editingClient.dueDate));
    setField("address", editingClient.address ?? "");
    setField("phone", editingClient.phone ?? "");
    setField("primaryEmployeeId", editingClient.primaryEmployee?.id ?? null);
    setField("secondaryEmployeeId", editingClient.secondaryEmployee?.id ?? null);
    setField("type", editingClient.type ?? "");
    setField("duration", editingClient.duration);
    setField("fullPrice", editingClient.fullPrice ?? "");
    setField("grant", editingClient.grant ?? "");
    setField("actualPrice", editingClient.actualPrice ?? "");
    setField("startDate", isoToYymmdd(editingClient.startDate));
    setField("endDate", isoToYymmdd(editingClient.endDate));
    setField("careCenter", editingClient.careCenter);
    setField("voucherClient", editingClient.voucherClient);
    setField("breastPump", editingClient.breastPump);
    setField("serviceStatus", editingClient.serviceStatus ?? "pre_booking");
    setField("areaId", editingClient.areaId ?? "");
    setPricesManuallyEdited(Boolean(editingClient.fullPrice || editingClient.grant || editingClient.actualPrice));
  }, [editingClient, setField, setPricesManuallyEdited]);

  useEffect(() => {
    if (!editingClient?.eDocId || !editingContractDocument) return;
    if (lastHydratedContractDocIdRef.current === editingClient.eDocId) return;

    const prefill = buildClientEditPrefillFromEformsignDocument(editingContractDocument);
    const hasPricePrefill = Boolean(prefill.fullPrice || prefill.grant || prefill.actualPrice);
    const initialVoucherType = resolveVoucherTypeValue(prefill.type);

    if ((prefill.primaryEmployeeName || prefill.secondaryEmployeeName) && isEmployeesLoading) {
      return;
    }

    if (
      hasPricePrefill &&
      (isAllVoucherPricesLoading || isAllVoucherPricesFetching || allVoucherPrices.length === 0)
    ) {
      return;
    }

    lastHydratedContractDocIdRef.current = editingClient.eDocId;

    const matchedVoucherPrice = hasPricePrefill
      ? findVoucherPriceByAmounts(allVoucherPrices, prefill)
      : undefined;
    const matchedDuration = matchedVoucherPrice?.duration ? Number(matchedVoucherPrice.duration) : undefined;
    const voucherType = initialVoucherType ?? resolveVoucherTypeValue(matchedVoucherPrice?.type);
    const voucherDuration = Number.isFinite(matchedDuration) ? matchedDuration : prefill.duration;
    const primaryEmployee = findEmployeeByContractPrefill(
      employees,
      prefill.primaryEmployeeName,
      prefill.primaryEmployeePhone,
    );
    const secondaryEmployee = findEmployeeByContractPrefill(
      employees,
      prefill.secondaryEmployeeName,
      prefill.secondaryEmployeePhone,
    );

    if (!store.birthday && prefill.birthday) setField("birthday", prefill.birthday);
    if (!store.dueDate && prefill.dueDate) setField("dueDate", prefill.dueDate);
    if (!store.address && prefill.address) setField("address", prefill.address);
    if (!store.phone && prefill.phone) setField("phone", prefill.phone);
    if (!store.type && voucherType) setField("type", voucherType);
    if (store.duration == null && voucherDuration != null) setField("duration", voucherDuration);
    if (!store.fullPrice && prefill.fullPrice) setField("fullPrice", prefill.fullPrice);
    if (!store.grant && prefill.grant) setField("grant", prefill.grant);
    if (!store.actualPrice && prefill.actualPrice) setField("actualPrice", prefill.actualPrice);
    if (!store.startDate && prefill.startDate) setField("startDate", prefill.startDate);
    if (!store.endDate && prefill.endDate) setField("endDate", prefill.endDate);
    if (store.primaryEmployeeId == null && primaryEmployee) setField("primaryEmployeeId", primaryEmployee.id);
    if (store.secondaryEmployeeId == null && secondaryEmployee) setField("secondaryEmployeeId", secondaryEmployee.id);

    if (hasPricePrefill) {
      setPricesManuallyEdited(true);
    }
  }, [
    editingClient?.eDocId,
    editingContractDocument,
    allVoucherPrices,
    employees,
    isAllVoucherPricesFetching,
    isAllVoucherPricesLoading,
    isEmployeesLoading,
    setField,
    setPricesManuallyEdited,
    store.actualPrice,
    store.address,
    store.birthday,
    store.dueDate,
    store.duration,
    store.endDate,
    store.fullPrice,
    store.grant,
    store.phone,
    store.primaryEmployeeId,
    store.secondaryEmployeeId,
    store.startDate,
    store.type,
  ]);

  useEffect(() => {
    if (phoneDigits.length !== 11) {
      return;
    }

    // 편집 모드에서 변경하지 않은 기존 번호는 중복 체크를 건너뛴다 (본인 번호이므로 항상 사용 가능).
    if (isUsingOriginalPhone) return;

    const abortController = new AbortController();

    const waitForRetryDelay = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          abortController.signal.removeEventListener("abort", handleAbort);
          resolve();
        };

        const timeoutId = setTimeout(finish, PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS);

        const handleAbort = () => {
          clearTimeout(timeoutId);
          finish();
        };

        if (abortController.signal.aborted) {
          handleAbort();
          return;
        }

        abortController.signal.addEventListener("abort", handleAbort, { once: true });
      });

    const checkPhoneDuplicate = async () => {
      setIsCheckingPhoneDuplicate(true);
      setIsPhoneDuplicate(false);
      setHasPhoneDuplicateCheckFailed(false);
      setLastCheckedPhoneDigits(null);

      let attempt = 0;

      while (!abortController.signal.aborted && attempt <= PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
        try {
          const response = await api.get("/clients/check-phone", {
            params: { phone: phoneDigits },
            signal: abortController.signal,
          });

          if (!abortController.signal.aborted) {
            setIsPhoneDuplicate(response.data?.exists === true);
            setHasPhoneDuplicateCheckFailed(false);
            setLastCheckedPhoneDigits(phoneDigits);
          }
          return;
        } catch {
          if (abortController.signal.aborted) {
            return;
          }

          attempt += 1;
          if (attempt > PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
            setIsPhoneDuplicate(false);
            setHasPhoneDuplicateCheckFailed(true);
            return;
          }

          await waitForRetryDelay();
        }
      }
    };

    void checkPhoneDuplicate().finally(() => {
      if (!abortController.signal.aborted) {
        setIsCheckingPhoneDuplicate(false);
      }
    });

    return () => {
      abortController.abort();
      setIsCheckingPhoneDuplicate(false);
    };
  }, [phoneDigits, isUsingOriginalPhone]);

  const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(store.type || "");

  const availableDurations = useMemo(() => {
    if (!voucherPriceInfos) return [];
    const durations = [...new Set(voucherPriceInfos.map((i) => Number(i.duration)))];
    return durations.sort((a, b) => a - b);
  }, [voucherPriceInfos]);
  const hasValidStoreDuration = store.duration != null && availableDurations.includes(store.duration);

  const inferredDurationFromPrices = useMemo(() => {
    if (!voucherPriceInfos || hasValidStoreDuration) return null;

    const matchedVoucherPrice = findVoucherPriceByAmounts(voucherPriceInfos, {
      fullPrice: store.fullPrice,
      grant: store.grant,
      actualPrice: store.actualPrice,
    });
    const matchedDuration = matchedVoucherPrice?.duration ? Number(matchedVoucherPrice.duration) : undefined;
    return matchedDuration !== undefined && Number.isFinite(matchedDuration) ? matchedDuration : null;
  }, [hasValidStoreDuration, store.actualPrice, store.fullPrice, store.grant, voucherPriceInfos]);
  const effectiveDuration = hasValidStoreDuration ? store.duration : inferredDurationFromPrices;

  const selectedPriceInfo = useMemo(() => {
    if (!voucherPriceInfos || !effectiveDuration) return null;
    return voucherPriceInfos.find((i) => Number(i.duration) === effectiveDuration);
  }, [effectiveDuration, voucherPriceInfos]);

  useEffect(() => {
    if (selectedPriceInfo && !pricesManuallyEdited) {
      setField("fullPrice", parsePrice(selectedPriceInfo.fullPrice));
      setField("grant", parsePrice(selectedPriceInfo.grant));
      setField("actualPrice", parsePrice(selectedPriceInfo.actualPrice));
    }
  }, [selectedPriceInfo, pricesManuallyEdited, setField]);

  useEffect(() => {
    if (!store.type || hasValidStoreDuration || !voucherPriceInfos) return;

    const matchedVoucherPrice = findVoucherPriceByAmounts(voucherPriceInfos, {
      fullPrice: store.fullPrice,
      grant: store.grant,
      actualPrice: store.actualPrice,
    });
    const matchedDuration = matchedVoucherPrice?.duration ? Number(matchedVoucherPrice.duration) : undefined;
    if (matchedDuration !== undefined && Number.isFinite(matchedDuration)) {
      setField("duration", matchedDuration);
    }
  }, [
    hasValidStoreDuration,
    setField,
    store.actualPrice,
    store.duration,
    store.fullPrice,
    store.grant,
    store.type,
    voucherPriceInfos,
  ]);

  // 시작일(YYMMDD) + 바우처 기간이 정해지면 평일(주말+한국 공휴일 제외) 기준으로 종료일 자동 계산.
  // 사용자가 종료일을 수동 편집해도 startDate/duration이 다시 바뀌어야만 덮어쓴다.
  useEffect(() => {
    if (!store.startDate || !effectiveDuration) return;
    if (!/^\d{6}$/.test(store.startDate)) return;
    const startIso = `20${store.startDate.slice(0, 2)}-${store.startDate.slice(2, 4)}-${store.startDate.slice(4, 6)}`;
    const endIso = calcEndDateBusinessDays(startIso, effectiveDuration);
    if (!endIso) return;
    const endYymmdd = `${endIso.slice(2, 4)}${endIso.slice(5, 7)}${endIso.slice(8, 10)}`;
    setField("endDate", endYymmdd);
  }, [effectiveDuration, store.startDate, setField]);

  const handleTypeChange = (newType: string) => {
    setField("type", newType);
    setField("duration", null);
    if (!pricesManuallyEdited) {
      setField("fullPrice", "");
      setField("grant", "");
      setField("actualPrice", "");
    }
  };

  const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
    setPricesManuallyEdited(true);
    setField(field, value);
  };

  const isStepSatisfied = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!store.name.trim()) return false;
        if (store.birthday.replace(/\D/g, "").length !== 6) return false;
        if (!store.dueDate) return false;
        if (phoneDigits.length !== 11) return false;
        if (isUsingOriginalPhone) return true;

        if (isCheckingPhoneDuplicate) {
          return false;
        }

        if (hasPhoneDuplicateCheckFailed) {
          return false;
        }

        if (lastCheckedPhoneDigits !== phoneDigits) {
          return false;
        }

        if (isPhoneDuplicate) return false;

        return true;
      case 1:
        return true;
      case 2:
        return true;
      case 3:
        return true;
      default:
        return true;
    }
  };

  const validateStep = (step: number): boolean => {
    if (isStepSatisfied(step)) return true;

    if (step === 0) {
      if (!store.name.trim()) {
        showFloatingError(t(locale, "clients.form.error-name-required"));
      } else if (store.birthday.replace(/\D/g, "").length !== 6) {
        showFloatingError(t(locale, "clients.form.error-birthday-required"));
      } else if (!store.dueDate) {
        showFloatingError(t(locale, "clients.form.error-due-date-required"));
      } else if (phoneDigits.length !== 11) {
        showFloatingError(t(locale, "clients.form.error-phone-required"));
      } else if (hasPhoneDuplicateCheckFailed) {
        showFloatingError(PHONE_DUPLICATE_CHECK_FAILED_MESSAGE);
      } else if (isPhoneDuplicate) {
        showFloatingError(t(locale, "clients.form.error-phone-duplicate"));
      }
    }

    return false;
  };

  const handleStepChange = (newStep: number) => {
    if (newStep > currentStep && !validateStep(currentStep)) return;
    setCurrentStep(newStep);
  };

  const handleComplete = async () => {
    if (!validateStep(currentStep)) return;

    try {
      const dto: CreateClientDto = {
        name: store.name,
        birthday: store.birthday || null,
        dueDate: yymmddToIso(store.dueDate),
        address: store.address || null,
        phone: store.phone || null,
        primaryEmployeeId: store.primaryEmployeeId,
        secondaryEmployeeId: store.secondaryEmployeeId,
        type: store.type || null,
        duration: effectiveDuration || null,
        fullPrice: store.fullPrice || null,
        grant: store.grant || null,
        actualPrice: store.actualPrice || null,
        startDate: yymmddToIso(store.startDate),
        endDate: yymmddToIso(store.endDate),
        careCenter: store.careCenter,
        voucherClient: store.voucherClient,
        breastPump: store.breastPump,
        serviceStatus: store.serviceStatus || null,
        areaId: store.areaId || null,
      };
      if (editingClientId !== null) {
        await updateClient.mutateAsync({ id: editingClientId, dto: dto as UpdateClientDto });
      } else {
        await createClient.mutateAsync(dto);
      }
      startNavigation();
      router.push(clientsReturnHref);
    } catch (err: unknown) {
      showFloatingError(getErrorMessage(err, locale, "clients.form.error-save-failed"));
    }
  };

  const handleEmployeeCreated = (newEmployee: Employee) => {
    if (employeeDialogTarget === "primary") {
      setField("primaryEmployeeId", newEmployee.id);
    } else if (employeeDialogTarget === "secondary") {
      setField("secondaryEmployeeId", newEmployee.id);
    }
  };

  const activeStep = Math.min(currentStep, WIZARD_STEPS.length - 1);
  const isFirstStep = activeStep === 0;
  const isLastStep = activeStep === WIZARD_STEPS.length - 1;
  const activeStepMeta = WIZARD_STEPS[activeStep];
  const progress = ((activeStep + 1) / WIZARD_STEPS.length) * 100;
  const clientsReturnHref = editingClientId !== null ? `/clients?id=${editingClientId}` : "/clients";
  const goBackToClients = () => {
    router.push(clientsReturnHref);
  };

  const handlePrev = () => {
    if (isFirstStep) return;
    setCurrentStep(activeStep - 1);
  };

  const handleNext = () => {
    if (isLastStep) {
      void handleComplete();
      return;
    }

    handleStepChange(activeStep + 1);
  };

  const isSaving = createClient.isPending || updateClient.isPending || isNavigationPending;
  const isPrimaryDisabled = isSaving || !isStepSatisfied(activeStep);

  return (
    <>
      <AnimatePresence>
        {floatingError && (
          <motion.div
            key="clients-new-floating-error"
            data-component="clients-new-toast"
            className="fixed right-4 top-[calc(env(safe-area-inset-top)+4.75rem)] z-[1001] max-w-[320px] overflow-hidden rounded-2xl bg-v3-burgundy-light px-4 py-3 text-[0.8rem] font-semibold text-v3-burgundy shadow-[0_8px_24px_hsla(349,50%,45%,0.2)] md:top-4"
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.92, y: -6 }
            }
            animate={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 1, scale: 1, y: 0 }
            }
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.95, y: -4 }
            }
            transition={{ duration: prefersReducedMotion ? 0.16 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {!prefersReducedMotion && (
              <motion.div
                data-component="clients-new-toast-ripple"
                className="pointer-events-none absolute inset-0 rounded-[inherit] border border-v3-burgundy/50"
                initial={{ opacity: 0.5, scale: 0.72 }}
                animate={{ opacity: 0, scale: 1.28 }}
                exit={{ opacity: 0, scale: 1.18 }}
                transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span data-component="clients-new-toast-text" className="relative z-[1]">
              {floatingError}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.pageRoot} data-component="clients-new-page-shell">
        <div className={styles.navPage} data-component="clients-new-nav-page">
          <header className={styles.navbar} data-component="clients-new-navbar">
            <button
              type="button"
              onClick={goBackToClients}
              className={styles.navbarIconButton}
              aria-label="고객 목록으로 돌아가기"
            >
              <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>

            <div className={styles.navbarTitle} data-component="clients-new-navbar-title">{isEditMode ? "고객 정보 수정" : "새 고객 추가"}</div>

            <button
              type="button"
              onClick={goBackToClients}
              className={styles.navbarIconButton}
              aria-label={isEditMode ? "고객 정보 수정 닫기" : "새 고객 추가 닫기"}
            >
              <X aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
          </header>

          <section className={styles.wizardContent} data-component="clients-new-wizard">
            <div className={styles.wizardHeader} data-component="clients-new-wizard-header">
              <div className={styles.progressRow} data-component="clients-new-progress-row">
                <div className={styles.progressTrack} data-component="clients-new-progress-track" aria-hidden="true">
                  <div className={styles.progressFill} data-component="clients-new-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className={styles.stepCount} data-component="clients-new-step-count">
                  <span>{activeStep + 1}</span> / {WIZARD_STEPS.length} 단계
                </div>
              </div>
              <h1 className={styles.stepTitle}>{activeStepMeta.title}</h1>
              <p className={styles.stepDesc}>{activeStepMeta.desc}</p>
            </div>

            <div className={styles.formScroll} data-component="clients-new-step-content">
              {activeStep === 0 ? (
                <>
                  <div className={styles.formCard} data-component="clients-new-basic-contact-card">
                    <Field label="이름" required>
                      <input
                        className={styles.formInput}
                        value={store.name}
                        onChange={(e) => setField("name", e.target.value)}
                        placeholder="홍길동"
                      />
                    </Field>
                    <Field label="연락처" required helper={phoneInlineMessage} helperTone={phoneHelperTone} helperPlacement="label">
                      <input
                        className={styles.formInput}
                        value={store.phone}
                        onChange={(e) => setField("phone", formatPhoneNumber(e.target.value))}
                        type="tel"
                        inputMode="numeric"
                        maxLength={13}
                        placeholder="010-1234-5678"
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="clients-new-basic-details-card">
                    <Field label="생년월일">
                      <input
                        className={styles.formInput}
                        value={store.birthday}
                        onChange={(e) => setField("birthday", e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                      />
                    </Field>
                    <Field label="출산 예정일">
                      <input
                        className={styles.formInput}
                        value={store.dueDate}
                        onChange={(e) => setField("dueDate", e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                      />
                    </Field>
                    <Field label="주소">
                      <input
                        className={styles.formInput}
                        value={store.address}
                        onChange={(e) => setField("address", e.target.value)}
                        placeholder="서울시 강남구..."
                      />
                    </Field>
                  </div>
                </>
              ) : null}

              {activeStep === 1 ? (
                <>
                  <div className={styles.formCard} data-component="clients-new-voucher-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">바우처</div>
                    <Field label="바우처 유형">
                      <div className={styles.selectWrap} data-component="clients-new-voucher-select-wrap">
                        <select
                          className={styles.formInput}
                          value={store.type}
                          onChange={(e) => handleTypeChange(e.target.value)}
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
                    <Field label="기간" helper="바우처 유형에 따라 선택 가능한 기간이 달라집니다.">
                      <div className={cn(styles.selectWrap, isPriceLoading ? styles.loadingSelect : !store.type && styles.disabledSelect)} data-component="clients-new-duration-select-wrap">
                        <select
                          className={styles.formInput}
                          value={effectiveDuration?.toString() || ""}
                          onChange={(e) => {
                            setField("duration", e.target.value ? Number(e.target.value) : null);
                            setPricesManuallyEdited(false);
                          }}
                          disabled={!store.type || isPriceLoading}
                        >
                          <option value="">선택하세요</option>
                          {availableDurations.map((d) => (
                            <option key={d} value={String(d)}>
                              {d}일
                            </option>
                          ))}
                        </select>
                      </div>
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="clients-new-bank-account-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">계좌번호</div>
                    <Field label="계좌번호">
                      <div
                        className={cn(
                          styles.selectWrap,
                          isBankAccountInfosLoading ? styles.loadingSelect : bankAccountInfos.length === 0 && styles.disabledSelect,
                        )}
                        data-component="clients-new-bank-account-select-wrap"
                      >
                        <select
                          className={styles.formInput}
                          value={store.areaId}
                          onChange={(e) => setField("areaId", e.target.value)}
                          disabled={isBankAccountInfosLoading || bankAccountInfos.length === 0}
                          data-component="clients-new-bank-account-select"
                        >
                          <option value="">
                            {isBankAccountInfosLoading ? "불러오는 중" : "계좌번호 선택"}
                          </option>
                          {store.areaId && !bankAccountInfos.some((account) => account.area === store.areaId) ? (
                            <option value={store.areaId}>
                              {getBankAccountAreaLabel(store.areaId)}
                            </option>
                          ) : null}
                          {bankAccountInfos.map((account) => (
                            <option key={account.area} value={account.area}>
                              {getBankAccountOptionLabel(account)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="clients-new-employee-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">제공인력 배정</div>
                    <Field label="제공인력 1">
                      <EmployeeAutocomplete
                        value={store.primaryEmployeeId}
                        onChange={(id) => setField("primaryEmployeeId", id)}
                        label=""
                        excludeIds={store.secondaryEmployeeId != null ? [store.secondaryEmployeeId] : []}
                        allowManualEntry
                        onManualEntry={() => {
                          setEmployeeDialogTarget("primary");
                          setIsEmployeeDialogOpen(true);
                        }}
                      />
                    </Field>
                    <Field label="제공인력 2">
                      <EmployeeAutocomplete
                        value={store.secondaryEmployeeId}
                        onChange={(id) => setField("secondaryEmployeeId", id)}
                        label=""
                        excludeIds={store.primaryEmployeeId != null ? [store.primaryEmployeeId] : []}
                        allowManualEntry
                        onManualEntry={() => {
                          setEmployeeDialogTarget("secondary");
                          setIsEmployeeDialogOpen(true);
                        }}
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="clients-new-pricing-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">
                      요금 정보
                      {selectedPriceInfo ? (
                        <span className={styles.autoBadge}>자동입력</span>
                      ) : null}
                    </div>
                    <Field label="총 서비스 금액">
                      <div className={styles.priceInput} data-component="clients-new-full-price-input-wrap">
                        <input
                          className={styles.formInput}
                          value={formatPrice(store.fullPrice)}
                          onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field label="정부지원금">
                      <div className={styles.priceInput} data-component="clients-new-grant-input-wrap">
                        <input
                          className={styles.formInput}
                          value={formatPrice(store.grant)}
                          onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field label="본인부담금" helper="총 서비스 금액 - 정부지원금 = 본인부담금. 직접 수정도 가능합니다.">
                      <div className={styles.priceInput} data-component="clients-new-actual-price-input-wrap">
                        <input
                          className={styles.formInput}
                          value={formatPrice(store.actualPrice)}
                          onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                  </div>

                  <div className={styles.formCard} data-component="clients-new-options-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">추가 옵션</div>
                    <div className={styles.toggleChipRow} data-component="clients-new-option-chips">
                      {([
                        { key: "voucherClient" as const, label: "바우처 고객" },
                        { key: "careCenter" as const, label: "조리원 이용" },
                        { key: "breastPump" as const, label: "유축기 대여" },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setField(key, !store[key])}
                          className={cn(styles.toggleChip, store[key] && styles.selected)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {activeStep === 2 ? (
                <>
                  <div className={styles.formCard} data-component="clients-new-contract-status-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">계약 상태</div>
                    <div className={styles.selectWrap} data-component="clients-new-status-select-wrap">
                      <select
                        className={styles.formInput}
                        value={store.serviceStatus}
                        onChange={(e) => setField("serviceStatus", e.target.value as ServiceStatus)}
                        data-component="clients-new-status-select"
                      >
                        {SERVICE_STATUS_OPTIONS.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className={styles.formCard} data-component="clients-new-service-period-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">서비스 기간</div>
                    <Field label="시작일">
                      <input
                        className={styles.formInput}
                        value={store.startDate}
                        onChange={(e) => setField("startDate", e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                      />
                    </Field>
                    <Field label="종료일">
                      <input
                        className={styles.formInput}
                        value={store.endDate}
                        onChange={(e) => setField("endDate", e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                      />
                    </Field>
                  </div>
                </>
              ) : null}
            </div>

            <div className={styles.wizardActions} data-component="clients-new-actions">
              <button
                type="button"
                onClick={handlePrev}
                disabled={isFirstStep}
                className={cn(styles.wizardButton, styles.secondaryButton)}
              >
                이전
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={isPrimaryDisabled}
                className={cn(styles.wizardButton, styles.primaryButton)}
              >
                {isSaving ? (isEditMode ? "저장 중..." : "등록 중...") : isLastStep ? (isEditMode ? "저장" : "등록") : "다음"}
              </button>
            </div>
          </section>
        </div>
      </div>

      <EmployeeFormDialog
        open={isEmployeeDialogOpen}
        onClose={() => {
          setIsEmployeeDialogOpen(false);
          setEmployeeDialogTarget(null);
        }}
        onSuccess={handleEmployeeCreated}
        assignmentLabel={employeeDialogTarget === "secondary" ? "제공인력 2에 배정" : "제공인력 1에 배정"}
      />
    </>
  );
}
