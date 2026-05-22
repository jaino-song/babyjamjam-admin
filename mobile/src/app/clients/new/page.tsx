"use client";

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCreateClient } from "@/hooks/useClients";
import { useVoucherPriceInfos } from "@/hooks/useVoucherData";
import type { CreateClientDto } from "@/lib/client/types";
import { SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { api } from "@/lib/api/client";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import type { Employee } from "@/hooks/useEmployees";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
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

type HelperTone = "muted" | "ok" | "err" | "pending";

function Field({
  label,
  required,
  children,
  helper,
  helperTone = "muted",
}: {
  label: ReactNode;
  required?: boolean;
  children: ReactNode;
  helper?: ReactNode;
  helperTone?: HelperTone;
}) {
  return (
    <div className={styles.formRow} data-component="clients-new-form-row">
      <label className={styles.formLabel}>
        {label}
        {required ? <span className={styles.requiredMark}>*</span> : null}
      </label>
      {children}
      {helper ? (
        <div className={cn(styles.formHelper, styles[`helper_${helperTone}`])} data-component="clients-new-form-helper">
          {helper}
        </div>
      ) : null}
    </div>
  );
}

function getVoucherTypeLabel(type: string): string {
  if (!type) return "";

  for (const types of Object.values(voucherOptions.voucherOptions)) {
    for (const [typeValue, typeData] of Object.entries(types)) {
      if (typeValue === type) return typeData.label;
    }
  }

  return type;
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

export default function NewClientPage() {
  const router = useRouter();
  const locale = useLocale();
  const createClient = useCreateClient();
  const prefillName = useClientDialogStore((s) => s.prefillName);
  const clearPrefillName = useClientDialogStore((s) => s.clearPrefillName);

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

  const phoneDigits = useMemo(() => store.phone.replace(/\D/g, ""), [store.phone]);
  const isPhoneAvailable =
    phoneDigits.length === 11 &&
    !isCheckingPhoneDuplicate &&
    !hasPhoneDuplicateCheckFailed &&
    !isPhoneDuplicate &&
    lastCheckedPhoneDigits === phoneDigits;
  const phoneInlineMessage = phoneDigits.length === 11
    ? isCheckingPhoneDuplicate
      ? "번호를 확인하고 있습니다."
      : hasPhoneDuplicateCheckFailed
        ? PHONE_DUPLICATE_CHECK_FAILED_MESSAGE
        : isPhoneDuplicate
          ? t(locale, "clients.form.error-phone-duplicate")
          : isPhoneAvailable
            ? "✓ 사용 가능한 번호입니다."
            : null
    : null;
  const phoneHelperTone: HelperTone = isCheckingPhoneDuplicate
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

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  useEffect(() => {
    if (prefillName) {
      setField("name", prefillName);
      clearPrefillName();
    }
  }, [prefillName, clearPrefillName, setField]);

  useEffect(() => {
    if (phoneDigits.length !== 11) {
      return;
    }

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
  }, [phoneDigits]);

  const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(store.type || "");

  const availableDurations = useMemo(() => {
    if (!voucherPriceInfos) return [];
    const durations = [...new Set(voucherPriceInfos.map((i) => Number(i.duration)))];
    return durations.sort((a, b) => a - b);
  }, [voucherPriceInfos]);

  const selectedPriceInfo = useMemo(() => {
    if (!voucherPriceInfos || !store.duration) return null;
    return voucherPriceInfos.find((i) => Number(i.duration) === store.duration);
  }, [voucherPriceInfos, store.duration]);

  useEffect(() => {
    if (selectedPriceInfo && !pricesManuallyEdited) {
      setField("fullPrice", parsePrice(selectedPriceInfo.fullPrice));
      setField("grant", parsePrice(selectedPriceInfo.grant));
      setField("actualPrice", parsePrice(selectedPriceInfo.actualPrice));
    }
  }, [selectedPriceInfo, pricesManuallyEdited, setField]);

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
        dueDate: store.dueDate || null,
        address: store.address || null,
        phone: store.phone || null,
        primaryEmployeeId: store.primaryEmployeeId,
        secondaryEmployeeId: store.secondaryEmployeeId,
        type: store.type || null,
        duration: store.duration || null,
        fullPrice: store.fullPrice || null,
        grant: store.grant || null,
        actualPrice: store.actualPrice || null,
        startDate: store.startDate || null,
        endDate: store.endDate || null,
        careCenter: store.careCenter,
        voucherClient: store.voucherClient,
        breastPump: store.breastPump,
        serviceStatus: store.serviceStatus || null,
      };
      const newClient = await createClient.mutateAsync(dto);
      router.push(`/clients?id=${newClient.id}`);
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
  const voucherTypeLabel = getVoucherTypeLabel(store.type);
  const summaryPills = [
    ...(activeStep >= 1 && store.name.trim() ? [store.name.trim()] : []),
    ...(activeStep >= 2 && voucherTypeLabel ? [voucherTypeLabel] : []),
    ...(activeStep >= 2 && store.duration ? [`${store.duration}일`] : []),
    ...(activeStep >= 2 && store.actualPrice ? [`${formatPrice(store.actualPrice)}원`] : []),
  ];

  const goBackToClients = () => {
    router.push("/clients");
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

  const isPrimaryDisabled = createClient.isPending || !isStepSatisfied(activeStep);

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

            <div className={styles.navbarTitle} data-component="clients-new-navbar-title">새 고객 추가</div>

            <button
              type="button"
              onClick={goBackToClients}
              className={styles.navbarIconButton}
              aria-label="새 고객 추가 닫기"
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

            {summaryPills.length > 0 ? (
              <div className={styles.summaryPills} data-component="clients-new-summary-pills">
                {summaryPills.map((pill) => (
                  <span key={pill} className={styles.summaryPill}>
                    {pill}
                  </span>
                ))}
              </div>
            ) : null}

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
                    <Field label="연락처" required helper={phoneInlineMessage} helperTone={phoneHelperTone}>
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
                    <Field label="출산 예정일" helper="출산 예정일 또는 서비스 시작 희망일">
                      <input
                        className={styles.formInput}
                        value={store.dueDate}
                        onChange={(e) => setField("dueDate", e.target.value)}
                        type="date"
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
                      <div className={cn(styles.selectWrap, (!store.type || isPriceLoading) && styles.disabledSelect)} data-component="clients-new-duration-select-wrap">
                        <select
                          className={styles.formInput}
                          value={store.duration?.toString() || ""}
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
                      {selectedPriceInfo && !pricesManuallyEdited ? (
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
                        { key: "careCenter" as const, label: "산후조리원" },
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
                    <div className={styles.statusRow} data-component="clients-new-status-chips">
                      {SERVICE_STATUS_OPTIONS.map((status) => (
                        <button
                          key={status.value}
                          type="button"
                          onClick={() => setField("serviceStatus", status.value)}
                          className={cn(
                            styles.statusChip,
                            status.value === "replacement_requested" && styles.statusChipWide,
                            store.serviceStatus === status.value && styles.selected
                          )}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.formCard} data-component="clients-new-service-period-card">
                    <div className={styles.formCardTitle} data-component="clients-new-form-card-title">서비스 기간</div>
                    <Field label="시작일">
                      <input
                        className={styles.formInput}
                        value={store.startDate}
                        onChange={(e) => setField("startDate", e.target.value)}
                        type="date"
                      />
                    </Field>
                    <Field label="종료일">
                      <input
                        className={styles.formInput}
                        value={store.endDate}
                        onChange={(e) => setField("endDate", e.target.value)}
                        type="date"
                      />
                    </Field>
                  </div>

                  <div className={styles.contractNotice} data-component="clients-new-contract-notice">
                    등록 시 고객에게 계약서 안내 메시지가 자동으로 전송됩니다.
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
                {createClient.isPending ? "등록 중..." : isLastStep ? "✓ 등록" : "다음 →"}
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
      />
    </>
  );
}
