"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useCreateClient } from "@/hooks/useClients";
import { useVoucherPriceInfos } from "@/hooks/useVoucherData";
import type { CreateClientDto } from "@/lib/client/types";
import { SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import type { Employee } from "@/hooks/useEmployees";
import { SteppedWizard } from "@/components/app/v3";
import type { WizardStep } from "@/components/app/v3";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full px-4 py-3 rounded-[14px] border-[1.5px] border-v3-border bg-white text-[0.85rem] font-[Pretendard] text-v3-dark outline-none transition-all focus:border-v3-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]";

const SELECT_CLS =
  "w-full px-4 py-3 rounded-[14px] border-[1.5px] border-v3-border bg-white text-[0.85rem] font-[Pretendard] text-v3-dark outline-none transition-all focus:border-v3-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center]";

const LABEL_CLS = "text-xs font-semibold text-v3-text-muted";

const GRID_CLS = "grid grid-cols-1 md:grid-cols-2 gap-4";

const COMPLETED_PILL =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-[14px] bg-v3-green-light border-[1.5px] border-[hsl(137,40%,85%)] text-[0.85rem] font-semibold text-v3-dark";

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

  const [error, setError] = useState<string | null>(null);
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);

  useEffect(() => {
    if (prefillName) {
      setField("name", prefillName);
      clearPrefillName();
    }
  }, [prefillName, clearPrefillName, setField]);

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
    setError(null);
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!store.name.trim()) {
          setError(t(locale, "clients.form.error-name-required"));
          return false;
        }
        return true;
      case 1:
        return true;
      case 2:
        return true;
      default:
        return true;
    }
  };

  const handleStepChange = (newStep: number) => {
    if (newStep > currentStep && !validateStep(currentStep)) return;
    setError(null);
    setCurrentStep(newStep);
  };

  const handleComplete = async () => {
    if (!validateStep(currentStep)) return;
    setError(null);

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
      reset();
      router.push(`/clients?id=${newClient.id}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, locale, "clients.form.error-save-failed"));
    }
  };

  const handleEmployeeCreated = (newEmployee: Employee) => {
    if (employeeDialogTarget === "primary") {
      setField("primaryEmployeeId", newEmployee.id);
    } else if (employeeDialogTarget === "secondary") {
      setField("secondaryEmployeeId", newEmployee.id);
    }
  };

  const steps: WizardStep[] = [
    {
      label: "기본 정보",
      content: (
        <div className={GRID_CLS}>
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLS}>
              {t(locale, "clients.form.name")} <span className="text-v3-burgundy">*</span>
            </label>
            <input
              className={INPUT_CLS}
              value={store.name}
              onChange={(e) => { setField("name", e.target.value); setError(null); }}
              placeholder="홍길동"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLS}>{t(locale, "clients.form.birthday")}</label>
            <input
              className={INPUT_CLS}
              value={store.birthday}
              onChange={(e) => setField("birthday", e.target.value)}
              placeholder="YYMMDD"
              maxLength={6}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLS}>{t(locale, "clients.form.due-date")}</label>
            <input
              type="date"
              className={INPUT_CLS}
              value={store.dueDate}
              onChange={(e) => setField("dueDate", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLS}>{t(locale, "clients.form.phone")}</label>
            <input
              className={INPUT_CLS}
              value={store.phone}
              onChange={(e) => setField("phone", formatPhoneNumber(e.target.value))}
              placeholder="010-1234-5678"
              maxLength={13}
            />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className={LABEL_CLS}>{t(locale, "clients.form.address")}</label>
            <input
              className={INPUT_CLS}
              value={store.address}
              onChange={(e) => setField("address", e.target.value)}
              placeholder="서울시 강남구..."
            />
          </div>
          {error && (
            <div className="md:col-span-2 text-[0.8rem] text-v3-burgundy font-semibold bg-v3-burgundy-light rounded-[14px] px-4 py-3">
              {error}
            </div>
          )}
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {store.name && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {store.name}
            </span>
          )}
          {store.phone && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {store.phone}
            </span>
          )}
          {store.address && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {store.address}
            </span>
          )}
        </div>
      ),
    },
    {
      label: "서비스 설정",
      content: (
        <div className="space-y-6">
          <div className={GRID_CLS}>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLS}>{t(locale, "clients.form.voucher-type")}</label>
              <select
                className={SELECT_CLS}
                value={store.type}
                onChange={(e) => handleTypeChange(e.target.value)}
              >
                <option value="">선택하세요</option>
                {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) =>
                  Object.entries(types).map(([typeValue, typeData]) => (
                    <option key={typeValue} value={typeValue}>
                      {groupName} — {typeData.label}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLS}>{t(locale, "clients.form.duration")}</label>
              <div className="relative">
                <select
                  className={cn(SELECT_CLS, (!store.type || isPriceLoading) && "opacity-50")}
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
                {isPriceLoading && (
                  <div className="absolute right-10 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-v3-primary/30 border-t-v3-primary rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={GRID_CLS}>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLS}>{t(locale, "clients.form.primary-employee")}</label>
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
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLS}>{t(locale, "clients.form.secondary-employee")}</label>
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
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className={LABEL_CLS}>{t(locale, "clients.form.section-pricing")}</span>
              {selectedPriceInfo && !pricesManuallyEdited && (
                <span className="text-[0.65rem] font-bold text-v3-primary bg-v3-primary-light px-2 py-0.5 rounded-full">
                  자동입력
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={LABEL_CLS}>{t(locale, "clients.form.full-price")}</label>
                <div className="relative">
                  <input
                    className={cn(INPUT_CLS, "pr-8")}
                    value={formatPrice(store.fullPrice)}
                    onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-v3-text-muted">원</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={LABEL_CLS}>{t(locale, "clients.form.grant")}</label>
                <div className="relative">
                  <input
                    className={cn(INPUT_CLS, "pr-8")}
                    value={formatPrice(store.grant)}
                    onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-v3-text-muted">원</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={LABEL_CLS}>{t(locale, "clients.form.actual-price")}</label>
                <div className="relative">
                  <input
                    className={cn(INPUT_CLS, "pr-8")}
                    value={formatPrice(store.actualPrice)}
                    onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-v3-text-muted">원</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <span className={cn(LABEL_CLS, "mb-3 block")}>{t(locale, "clients.form.section-flags")}</span>
            <div className="flex flex-wrap gap-3">
              {([
                { key: "voucherClient" as const, label: t(locale, "clients.form.voucher-client") },
                { key: "careCenter" as const, label: t(locale, "clients.form.care-center") },
                { key: "breastPump" as const, label: t(locale, "clients.form.breast-pump") },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setField(key, !store[key])}
                  className={cn(
                    "px-4 py-2.5 rounded-[14px] text-[0.8rem] font-semibold transition-all border-[1.5px]",
                    store[key]
                      ? "bg-v3-primary-light border-v3-primary text-v3-primary"
                      : "bg-white border-v3-border text-v3-text-muted hover:border-v3-primary/40"
                  )}
                >
                  {store[key] && <Check className="w-3.5 h-3.5 inline mr-1.5" strokeWidth={2.5} />}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-[0.8rem] text-v3-burgundy font-semibold bg-v3-burgundy-light rounded-[14px] px-4 py-3">
              {error}
            </div>
          )}
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap">
          {store.type && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {store.type}
            </span>
          )}
          {store.duration && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {store.duration}일
            </span>
          )}
          {store.actualPrice && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {formatPrice(store.actualPrice)}원
            </span>
          )}
        </div>
      ),
    },
    {
      label: "계약 정보",
      content: (
        <div className="space-y-6">
          <div className={GRID_CLS}>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLS}>{t(locale, "clients.form.contract-status")}</label>
              <select
                className={SELECT_CLS}
                value={store.serviceStatus}
                onChange={(e) => setField("serviceStatus", e.target.value)}
              >
                {SERVICE_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div />
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLS}>{t(locale, "clients.form.start-date")}</label>
              <input
                type="date"
                className={INPUT_CLS}
                value={store.startDate}
                onChange={(e) => setField("startDate", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL_CLS}>{t(locale, "clients.form.end-date")}</label>
              <input
                type="date"
                className={INPUT_CLS}
                value={store.endDate}
                onChange={(e) => setField("endDate", e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="text-[0.8rem] text-v3-burgundy font-semibold bg-v3-burgundy-light rounded-[14px] px-4 py-3">
              {error}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <SteppedWizard
        title={t(locale, "clients.form.add-title")}
        subtitle="고객 정보를 단계별로 입력해 주세요"
        steps={steps}
        currentStep={currentStep}
        onStepChange={handleStepChange}
        onComplete={handleComplete}
        onBack={() => router.push("/clients")}
        backLabel="고객 목록으로 돌아가기"
        completeLabel="등록"
        isSubmitting={createClient.isPending}
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
