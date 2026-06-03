"use client";

import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import dayjs from "dayjs";
import { useQueryClient } from "@tanstack/react-query";

import { useFormStore } from "@/stores/form-store";
import { useEformsign } from "@/hooks/useEformsign";
import { useVoucherYears, useVoucherPriceInfos, useAreaTemplates } from "@/hooks";
import { useCreateClient } from "@/hooks/useClients";
import { useEmployees, type Employee } from "@/hooks/useEmployees";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { eformsignApi } from "@/services/api";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import type { Client } from "@/lib/client/types";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";

import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { isStrictIsoDate, isoToYymmdd, normalizeIsoDate, yymmddToIso } from "@/lib/contracts/date-input";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { buildInitialSignRequestDocRecord } from "@/lib/eformsign/document-record";
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
import { cn } from "@/lib/utils";
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
  receiptYear: string; receiptMonth: string; receiptDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

const WIZARD_STEPS = [
  { title: "이용자 정보", desc: "기존 고객을 검색하거나 정보를 입력해주세요." },
  { title: "제공인력 정보", desc: "계약에 배정될 제공인력을 선택해주세요." },
  { title: "바우처 정보", desc: "바우처 유형과 기간, 요금을 확인해주세요." },
  { title: "계약 정보", desc: "서비스 기간과 결제 예정일을 입력해주세요." },
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
    <div className={styles.formRow} data-component="contracts-creation-form-row">
      <label className={styles.formLabel}>
        {label}
        {required ? <span className={styles.requiredMark}>*</span> : null}
      </label>
      {children}
      {helper ? (
        <div className={cn(styles.formHelper, styles[`helper_${helperTone}`])} data-component="contracts-creation-form-helper">
          {helper}
        </div>
      ) : null}
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

export default function ContractCreationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const prefersReducedMotion = useReducedMotion();

  const createClientMutation = useCreateClient();
  const { isLoaded: isEformsignLoaded, openDocument } = useEformsign();
  const { data: voucherYears } = useVoucherYears();
  const { data: areaTemplates } = useAreaTemplates();
  const { data: employees } = useEmployees();

  const {
    clientId, isManualEntry, name, phone, birthday, address, dueDate, area,
    employeeId, isEmployeeManualEntry, employeeName, employeePhone,
    showEmployee2, employee2Id, isEmployee2ManualEntry, employee2Name, employee2Phone,
    voucherType, voucherDuration, voucherYear,
    fullPrice, grant, actualPrice,
    startDate, endDate, paymentDate,
    setClientId, setIsManualEntry, setName, setPhone, setBirthday, setAddress, setDueDate, setArea,
    setIsEmployeeManualEntry, setEmployeeSelection,
    setShowEmployee2, setIsEmployee2ManualEntry, setEmployee2Selection,
    setVoucherType, setVoucherDuration, setVoucherYear,
    setFullPrice, setGrant, setActualPrice,
    setStartDate, setEndDate, setPaymentDate,
  } = useFormStore();

  const { data: voucherPriceInfos, isLoading: isPriceLoading } =
    useVoucherPriceInfos(voucherType || "", voucherYear || 0);

  const [activeStep, setActiveStep] = useState(0);
  const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);
  const [floatingError, setFloatingError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEformsignModalOpen, setIsEformsignModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [creationProgress, setCreationProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [progressErrorHint, setProgressErrorHint] = useState<string | null>(null);
  const progressSourceRef = useRef<EventSource | null>(null);
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);
  const floatingErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedClientRef = useRef<Client | null>(null);

  // Local YYMMDD drafts so partial input doesn't trash the ISO store value
  const [dueDateInput, setDueDateInput] = useState("");
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");

  useEffect(() => { setDueDateInput(isoToYymmdd(dueDate)); }, [dueDate]);
  useEffect(() => { setStartDateInput(isoToYymmdd(startDate)); }, [startDate]);
  useEffect(() => { setEndDateInput(isoToYymmdd(endDate)); }, [endDate]);
  useEffect(() => { setPaymentDateInput(isoToYymmdd(paymentDate)); }, [paymentDate]);

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

  // Default voucher year to the most recent available
  useEffect(() => {
    if (!voucherYear && voucherYears && voucherYears.length > 0) {
      setVoucherYear(Math.max(...voucherYears));
    }
  }, [voucherYear, voucherYears, setVoucherYear]);

  // Auto-fill prices from voucher selection unless user edited manually
  useEffect(() => {
    if (selectedPriceInfo && !pricesManuallyEdited) {
      if (selectedPriceInfo.fullPrice != null) setFullPrice(String(selectedPriceInfo.fullPrice));
      if (selectedPriceInfo.grant != null) setGrant(String(selectedPriceInfo.grant));
      if (selectedPriceInfo.actualPrice != null) setActualPrice(String(selectedPriceInfo.actualPrice));
    }
  }, [selectedPriceInfo, pricesManuallyEdited, setFullPrice, setGrant, setActualPrice]);

  // Business-day end date auto-calc from startDate + duration
  useEffect(() => {
    if (!startDate || !voucherDuration) return;
    const n = parseInt(voucherDuration, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const endIso = calcEndDateBusinessDays(startDate, n);
    if (endIso) setEndDate(endIso);
  }, [startDate, voucherDuration, setEndDate]);

  const showFloatingError = (message: string) => {
    setFloatingError(message);
    if (floatingErrorTimeoutRef.current) clearTimeout(floatingErrorTimeoutRef.current);
    floatingErrorTimeoutRef.current = setTimeout(() => {
      setFloatingError(null);
      floatingErrorTimeoutRef.current = null;
    }, 5000);
  };

  useEffect(() => () => {
    if (floatingErrorTimeoutRef.current) clearTimeout(floatingErrorTimeoutRef.current);
    progressSourceRef.current?.close();
  }, []);

  const handleClientSelect = (selectedClientId: number | null, client: Client | null) => {
    setClientId(selectedClientId);
    selectedClientRef.current = client;
    if (client) {
      setName(client.name);
      setPhone(client.phone || "");
      setBirthday(client.birthday || "");
      setAddress(client.address || "");
      setDueDate(normalizeIsoDate(client.dueDate));
      if (client.type) setVoucherType(client.type);
      if (client.duration) setVoucherDuration(client.duration.toString());
      if (client.fullPrice) setFullPrice(client.fullPrice);
      if (client.grant) setGrant(client.grant);
      if (client.actualPrice) setActualPrice(client.actualPrice);
      if (client.startDate) {
        const startNorm = normalizeIsoDate(client.startDate);
        setStartDate(startNorm);
        setPaymentDate(startNorm);
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
      setStartDate(""); setEndDate(""); setPaymentDate("");
      setEmployeeSelection(null, "", "");
      setEmployee2Selection(null, "", "");
      setShowEmployee2(false);
    }
    setPricesManuallyEdited(false);
  };

  const handleClientManualEntry = () => {
    setIsManualEntry(true);
    setIsClientDialogOpen(true);
  };

  const handleClientCreated = (newClient: Client) => {
    handleClientSelect(newClient.id, newClient);
    setIsClientDialogOpen(false);
  };

  const handleEmployeeSelect = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) setEmployeeSelection(selectedEmployeeId, employee.name, employee.phone);
    else setEmployeeSelection(null, "", "");
  };

  const handleEmployee2Select = (selectedEmployeeId: number | null, employee: Employee | null) => {
    if (employee) setEmployee2Selection(selectedEmployeeId, employee.name, employee.phone);
    else setEmployee2Selection(null, "", "");
  };

  const handleEmployeeCreated = (newEmployee: Employee) => {
    if (employeeDialogTarget === "primary") {
      setEmployeeSelection(newEmployee.id, newEmployee.name, newEmployee.phone);
      setIsEmployeeManualEntry(false);
    } else if (employeeDialogTarget === "secondary") {
      setShowEmployee2(true);
      setEmployee2Selection(newEmployee.id, newEmployee.name, newEmployee.phone);
      setIsEmployee2ManualEntry(false);
    }
    setIsEmployeeDialogOpen(false);
    setEmployeeDialogTarget(null);
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
    (clientId !== null || (isManualEntry && name.trim() && phone.trim())) && area
  );
  const isEmployee1Valid = Boolean(
    isEmployeeManualEntry ? employeeName.trim() && employeePhone.trim() : employeeId !== null
  );
  const isEmployee2Valid = Boolean(
    !showEmployee2 || (isEmployee2ManualEntry ? employee2Name.trim() && employee2Phone.trim() : employee2Id !== null)
  );
  const isStep2Valid = isEmployee1Valid && isEmployee2Valid;
  const isStep3Valid = Boolean(voucherType && voucherDuration && fullPrice && grant && actualPrice);
  const isStep4Valid = Boolean(
    startDate && isStrictIsoDate(startDate) &&
    endDate && isStrictIsoDate(endDate) &&
    paymentDate && isStrictIsoDate(paymentDate)
  );
  const isCurrentStepValid = [isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid][activeStep] ?? true;

  const getStepValidationMessage = (step: number): string | null => {
    if (step === 0 && !isStep1Valid) return "고객 정보와 계약서를 선택해 주세요.";
    if (step === 1 && !isStep2Valid) return "제공인력 정보를 모두 입력해 주세요.";
    if (step === 2 && !isStep3Valid) return "바우처 유형/기간과 금액 정보를 입력해 주세요.";
    if (step === 3 && !isStep4Valid) return "계약 시작일, 종료일, 결제일을 입력해 주세요.";
    return null;
  };

  const handleNext = () => {
    if (!isCurrentStepValid) {
      const msg = getStepValidationMessage(activeStep);
      if (msg) showFloatingError(msg);
      return;
    }
    if (activeStep === WIZARD_STEPS.length - 1) {
      void handleSubmit();
      return;
    }
    setActiveStep((s) => s + 1);
  };

  const handlePrev = () => {
    if (activeStep === 0) return;
    setActiveStep((s) => s - 1);
  };

  const runIframeFallback = async (
    contractData: ContractDataDto,
    finalClientId: number | null,
    expiry: dayjs.Dayjs,
  ) => {
    if (!isEformsignLoaded) {
      showFloatingError("eformsign SDK가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const documentOption: EformsignDocumentOption = await eformsignApi.generateDocument(
      contractData as unknown as Parameters<typeof eformsignApi.generateDocument>[0],
      finalClientId ?? undefined,
    );
    setIsEformsignModalOpen(true);
    setTimeout(() => {
      openDocument(documentOption, "eformsign_iframe", {
        onSuccess: async (response) => {
          if (finalClientId && response.document_id) {
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
              console.error("Failed to create eformsign doc record:", docError);
            }
          }
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          alert("계약서가 성공적으로 생성되었습니다.");
          setIsEformsignModalOpen(false);
          router.push("/contracts");
        },
        onError: (response) => {
          showFloatingError(`문서 생성 실패: ${response.message}`);
          setIsEformsignModalOpen(false);
        },
        onAction: () => { /* noop */ },
      });
    }, 500);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setProgressErrorHint(null);

    try {
      // 1. Manual-entry client creation
      let finalClientId = clientId;
      if (isManualEntry && !clientId) {
        const newClient = await createClientMutation.mutateAsync({
          name,
          phone,
          birthday: birthday || undefined,
          address: address || undefined,
          dueDate: dueDate || undefined,
          primaryEmployeeId: null,
          careCenter: false,
          voucherClient: true,
          breastPump: false,
        });
        finalClientId = newClient.id;
        setClientId(newClient.id);
      }

      // 2. Eformsign auth (cookies)
      const authResult = await eformsignApi.authenticate(Date.now());
      if (!authResult.success) throw new Error("Failed to authenticate");

      // 3. Build contract data
      const start = dayjs(startDate);
      const end = dayjs(endDate);
      const payment = dayjs(paymentDate);
      const today = dayjs();
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
        receiptYear: today.format("YY"), receiptMonth: today.format("MM"), receiptDay: today.format("DD"),
        fullPrice, grant, actualPrice,
      };

      // 4. Headless dispatch (primary path)
      const progressId = createHeadlessProgressId();
      let headlessOk = false;
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
              if (next !== current) {
                setProgressErrorHint(errorHint);
              }
              return next;
            });
            return;
          }
          if (!isHeadlessProgressStepKey(data.step, CONTRACT_CREATION_PROGRESS_STEPS)) return;
          const nextStep = data.step;
          setCreationProgress((current) =>
            resolveNextHeadlessProgress(current, nextStep, CONTRACT_CREATION_PROGRESS_STEPS),
          );
        });

        const headless = await eformsignApi.dispatchHeadless(
          contractData as unknown as Parameters<typeof eformsignApi.dispatchHeadless>[0],
          finalClientId ?? undefined,
          progressId,
        );

        if (headless.ok) {
          headlessOk = true;
          setCreationProgress({ step: "sent", completed: true, failed: false });
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          setTimeout(() => {
            setIsProgressModalOpen(false);
            alert("계약서가 성공적으로 생성되었습니다.");
            router.push("/contracts");
          }, 800);
          return;
        }

        console.warn("[contract-creation] headless dispatch returned ok=false", headless.reason);
        const errorHint = getSafeHeadlessFailureMessage(headless.reason);
        setCreationProgress((current) => {
          const next = resolveFailedHeadlessProgress(
            current,
            headless.failedStep,
            CONTRACT_CREATION_PROGRESS_STEPS,
          );
          if (next !== current) {
            setProgressErrorHint(errorHint);
          }
          return next;
        });
      } catch (headlessError) {
        console.warn("[contract-creation] headless dispatch threw", headlessError);
        const errorHint = getSafeHeadlessFailureMessage(headlessError instanceof Error ? headlessError.message : undefined);
        setCreationProgress((current) => {
          const next = resolveFailedHeadlessProgress(
            current,
            undefined,
            CONTRACT_CREATION_PROGRESS_STEPS,
          );
          if (next !== current) {
            setProgressErrorHint(errorHint);
          }
          return next;
        });
      } finally {
        progressSource?.close();
        progressSourceRef.current = null;
      }

      // 5. Fallback to iframe modal if headless failed
      if (!headlessOk) {
        setIsProgressModalOpen(false);
        await runIframeFallback(contractData, finalClientId, end);
      }
    } catch (err: unknown) {
      setIsProgressModalOpen(false);
      const msg = err instanceof Error ? err.message : "계약서 생성 중 오류가 발생했습니다.";
      showFloatingError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBack = () => router.push("/contracts");
  const progress = ((activeStep + 1) / WIZARD_STEPS.length) * 100;
  const activeStepMeta = WIZARD_STEPS[activeStep];
  const isFirstStep = activeStep === 0;
  const isLastStep = activeStep === WIZARD_STEPS.length - 1;
  const isPrimaryDisabled = isSubmitting || !isCurrentStepValid;

  return (
    <>
      <AnimatePresence>
        {floatingError && (
          <motion.div
            data-component="contracts-creation-toast"
            className="fixed right-4 top-[calc(env(safe-area-inset-top)+4.75rem)] z-[1001] max-w-[320px] overflow-hidden rounded-2xl bg-v3-burgundy-light px-4 py-3 text-[0.8rem] font-semibold text-v3-burgundy shadow-[0_8px_24px_hsla(349,50%,45%,0.2)] md:top-4"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -6 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: prefersReducedMotion ? 0.16 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="relative z-[1]">{floatingError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.pageRoot} data-component="contracts-creation-page-shell">
        <div className={styles.navPage}>
          <header className={styles.navbar}>
            <button type="button" onClick={goBack} className={styles.navbarIconButton} aria-label="계약 목록으로 돌아가기">
              <ChevronLeft aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
            <div className={styles.navbarTitle}>계약서 생성</div>
            <button type="button" onClick={goBack} className={styles.navbarIconButton} aria-label="계약서 생성 닫기">
              <X aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
          </header>

          <section className={styles.wizardContent}>
            <div className={styles.wizardHeader}>
              <div className={styles.progressRow}>
                <div className={styles.progressTrack} aria-hidden="true">
                  <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                </div>
                <div className={styles.stepCount}>
                  <span>{activeStep + 1}</span> / {WIZARD_STEPS.length} 단계
                </div>
              </div>
              <h1 className={styles.stepTitle}>{activeStepMeta.title}</h1>
              <p className={styles.stepDesc}>{activeStepMeta.desc}</p>
            </div>

            <div className={styles.formScroll}>
              {activeStep === 0 ? (
                <>
                  <div className={styles.formCard} data-component="contracts-creation-client-card">
                    <div className={styles.formCardTitle}>
                      이용자 선택
                      <span className={styles.optionalBadge}>기존 고객</span>
                    </div>
                    <ClientAutocomplete
                      value={clientId}
                      onChange={handleClientSelect}
                      label=""
                      allowManualEntry
                      onManualEntry={handleClientManualEntry}
                    />
                  </div>

                  <div className={styles.formCard}>
                    <Field label="이름" required>
                      <input
                        className={styles.formInput}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="홍길동"
                      />
                    </Field>
                    <Field label="연락처" required>
                      <input
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
                      <Field label="생년월일">
                        <input
                          className={styles.formInput}
                          value={birthday}
                          onChange={(e) => setBirthday(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                      <Field label="출산 예정일">
                        <input
                          className={styles.formInput}
                          value={dueDateInput}
                          onChange={(e) => handleDateInputChange(setDueDateInput, setDueDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                    </div>
                    <Field label="주소">
                      <input
                        className={styles.formInput}
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="서울시 강남구..."
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard}>
                    <Field
                      label="계약서 유형"
                      required
                      helper="eformsign 템플릿에서 선택됩니다."
                    >
                      <div className={styles.selectWrap}>
                        <select
                          className={styles.formInput}
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                        >
                          <option value="">선택하세요</option>
                          {(areaTemplates ?? []).map((tpl) => (
                            <option key={tpl.areaId} value={tpl.areaId}>
                              {tpl.templateName}
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
                  <div className={styles.formCard}>
                    <div className={styles.formCardTitle}>
                      제공인력 1<span className={styles.requiredMark}>*</span>
                    </div>
                    <EmployeeAutocomplete
                      value={employeeId}
                      onChange={handleEmployeeSelect}
                      label=""
                      excludeIds={employee2Id != null ? [employee2Id] : []}
                      allowManualEntry
                      onManualEntry={() => {
                        setEmployeeDialogTarget("primary");
                        setIsEmployeeDialogOpen(true);
                      }}
                    />
                  </div>

                  <div className={styles.formCard}>
                    <div
                      className={styles.toggleRow}
                      onClick={() => {
                        if (showEmployee2) {
                          setShowEmployee2(false);
                          setEmployee2Selection(null, "", "");
                        } else {
                          setShowEmployee2(true);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div>
                        <div className={styles.toggleLabel}>제공인력 2 추가</div>
                        <div className={styles.toggleSub}>쌍태아·삼태아 등 2인 배정 시 사용</div>
                      </div>
                      <button
                        type="button"
                        aria-label="제공인력 2 토글"
                        aria-pressed={showEmployee2}
                        className={cn(styles.toggleSwitch, showEmployee2 && styles.on)}
                      />
                    </div>
                    {showEmployee2 ? (
                      <>
                        <div className={styles.dashedDivider} />
                        <EmployeeAutocomplete
                          value={employee2Id}
                          onChange={handleEmployee2Select}
                          label=""
                          excludeIds={employeeId != null ? [employeeId] : []}
                          allowManualEntry
                          onManualEntry={() => {
                            setEmployeeDialogTarget("secondary");
                            setIsEmployeeDialogOpen(true);
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}

              {activeStep === 2 ? (
                <>
                  <div className={styles.formCard}>
                    <div className={styles.formCardTitle}>바우처 선택</div>
                    <div className={styles.formGrid2}>
                      <Field label="연도" required>
                        <div className={styles.selectWrap}>
                          <select
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
                      <Field label="기간" required>
                        <div className={cn(styles.selectWrap, isPriceLoading ? styles.loadingSelect : !voucherType && styles.disabledSelect)}>
                          <select
                            className={styles.formInput}
                            value={voucherDuration}
                            onChange={(e) => handleDurationChange(e.target.value)}
                            disabled={!voucherType || isPriceLoading}
                          >
                            <option value="">선택</option>
                            {availableDurations.map((d) => (
                              <option key={d} value={d}>{d}일</option>
                            ))}
                          </select>
                        </div>
                      </Field>
                    </div>
                    <Field label="바우처 유형" required>
                      <div className={styles.selectWrap}>
                        <select
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

                  <div className={styles.formCard}>
                    <div className={styles.formCardTitle}>
                      요금 정보
                      {selectedPriceInfo && !pricesManuallyEdited ? (
                        <span className={styles.autoBadge}>자동입력</span>
                      ) : null}
                    </div>
                    <Field label="총 서비스 금액" required>
                      <div className={styles.priceInput}>
                        <input
                          className={styles.formInput}
                          value={formatPrice(fullPrice)}
                          onChange={(e) => handlePriceChange("fullPrice", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field label="정부지원금" required>
                      <div className={styles.priceInput}>
                        <input
                          className={styles.formInput}
                          value={formatPrice(grant)}
                          onChange={(e) => handlePriceChange("grant", parsePrice(e.target.value))}
                          inputMode="numeric"
                          placeholder="0"
                        />
                        <span>원</span>
                      </div>
                    </Field>
                    <Field
                      label="본인부담금"
                      required
                      helper="총 서비스 금액 − 정부지원금 = 본인부담금. 직접 수정도 가능합니다."
                    >
                      <div className={styles.priceInput}>
                        <input
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
                  <div className={styles.formCard}>
                    <div className={styles.formCardTitle}>서비스 기간</div>
                    <div className={styles.formGrid2}>
                      <Field label="시작일" required>
                        <input
                          className={styles.formInput}
                          value={startDateInput}
                          onChange={(e) => handleDateInputChange(setStartDateInput, setStartDate, e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="YYMMDD"
                        />
                      </Field>
                      <Field label="종료일" required>
                        <input
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

                  <div className={styles.formCard}>
                    <div className={styles.formCardTitle}>결제 정보</div>
                    <Field
                      label="결제 예정일"
                      required
                      helper="고객으로부터 본인부담금을 수령할 예정일입니다."
                    >
                      <input
                        className={styles.formInput}
                        value={paymentDateInput}
                        onChange={(e) => handleDateInputChange(setPaymentDateInput, setPaymentDate, e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                      />
                    </Field>
                  </div>

                  <div className={styles.formCard}>
                    <div className={styles.formCardTitle}>최종 확인</div>
                    <div className={styles.priceSummary}>
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
                            ? `${dayjs(startDate).format("M/D")} → ${dayjs(endDate).format("M/D")}`
                            : "-"}
                        </span>
                      </div>
                      <div className={cn(styles.priceSummaryRow, styles.total)}>
                        <span>본인부담금</span>
                        <span className={styles.amount}>{actualPrice ? `${formatPrice(actualPrice)} 원` : "-"}</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.contractNotice}>
                    생성 시 eformsign으로 계약서가 발송되고, 고객에게 안내 알림톡이 전송됩니다.
                  </div>
                </>
              ) : null}
            </div>

            <div className={styles.wizardActions}>
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
                {isSubmitting ? "생성 중..." : isLastStep ? "계약서 생성" : "다음"}
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
        dataComponentPrefix="contracts-creation-progress"
      />

      {isEformsignModalOpen ? (
        <div className={styles.eformsignModal} data-component="contracts-creation-eformsign-modal">
          <div className={styles.eformsignModalHeader}>
            <span>계약서 서명</span>
            <button
              type="button"
              onClick={() => setIsEformsignModalOpen(false)}
              className={styles.navbarIconButton}
              aria-label="닫기"
            >
              <X aria-hidden="true" size={20} strokeWidth={2.5} />
            </button>
          </div>
          <iframe id="eformsign_iframe" className={styles.eformsignIframe} title="eformsign" />
        </div>
      ) : null}

      <ClientFormDialog
        open={isClientDialogOpen}
        onClose={() => setIsClientDialogOpen(false)}
        onSuccess={handleClientCreated}
      />
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
