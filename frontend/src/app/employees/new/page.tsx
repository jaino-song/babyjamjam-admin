"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { SteppedWizard } from "@/components/app/v3";
import type { WizardStep } from "@/components/app/v3";
import { formatWorkAreaLabel, GRADES, WORK_AREAS } from "@/components/app/employees/employee-form.constants";
import { useCreateEmployee } from "@/hooks/useEmployees";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { t } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";

const INPUT_CLS =
  "w-full px-4 py-3 rounded-[14px] border-[1.5px] border-v3-border bg-white text-[0.85rem] font-[Pretendard] text-v3-dark outline-none transition-all focus:border-v3-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]";

const SELECT_CLS =
  "w-full px-4 py-3 rounded-[14px] border-[1.5px] border-v3-border bg-white text-[0.85rem] font-[Pretendard] text-v3-dark outline-none transition-all focus:border-v3-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)] appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center]";

const LABEL_CLS = "text-xs font-semibold text-v3-text-muted";

const GRID_CLS = "grid grid-cols-1 md:grid-cols-2 gap-4";

const COMPLETED_PILL =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-[14px] bg-v3-green-light border-[1.5px] border-[hsl(137,40%,85%)] text-[0.85rem] font-semibold text-v3-dark";

function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

function sanitizeReturnTo(path: string | null): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

function buildReturnUrl(basePath: string, params: Record<string, string | null>) {
  const [pathname, queryString] = basePath.split("?", 2);
  const nextParams = new URLSearchParams(queryString ?? "");

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      nextParams.set(key, value);
    }
  });

  const query = nextParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function NewEmployeePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const createEmployee = useCreateEmployee();
  const prefillName = useEmployeeDialogStore((state) => state.prefillName);
  const clearPrefillName = useEmployeeDialogStore((state) => state.clearPrefillName);
  const store = useEmployeeWizardStore();
  const { currentStep, setField, setCurrentStep, reset } = store;

  const [error, setError] = useState<string | null>(null);

  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get("returnTo")),
    [searchParams]
  );
  const target = searchParams.get("target");

  useEffect(() => {
    if (prefillName && !store.name) {
      setField("name", prefillName);
      clearPrefillName();
    }
  }, [clearPrefillName, prefillName, setField, store.name]);

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!store.name.trim()) {
          setError(
            locale === "ko"
              ? `${t(locale, "employees.form.name")}을 입력해주세요.`
              : `Please enter ${t(locale, "employees.form.name").toLowerCase()}.`
          );
          return false;
        }
        if (!store.phone.trim()) {
          setError(t(locale, "employees.form.phone-required"));
          return false;
        }
        return true;
      case 1:
        if (store.workArea.length === 0) {
          setError(t(locale, "employees.form.work-area-required"));
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const handleStepChange = (nextStep: number) => {
    if (nextStep > currentStep && !validateStep(currentStep)) {
      return;
    }

    setError(null);
    setCurrentStep(nextStep);
  };

  const handleComplete = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    setError(null);

    try {
      const newEmployee = await createEmployee.mutateAsync({
        name: store.name.trim(),
        workArea: store.workArea,
        phone: store.phone.replace(/\D/g, ""),
        grade: store.grade,
        openToNextWork: store.openToNextWork,
      });

      reset();

      if (returnTo) {
        const safeTarget = target === "primary" || target === "secondary" ? target : null;
        router.push(
          buildReturnUrl(returnTo, {
            employeeCreatedId: String(newEmployee.id),
            target: safeTarget,
          })
        );
        return;
      }

      router.push(`/employees?id=${newEmployee.id}`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, locale, "employees.form.error-create-failed"));
    }
  };

  const steps: WizardStep[] = [
    {
      label: t(locale, "employees.form.section-basic"),
      content: (
        <div className={GRID_CLS} data-component="employees-new-basic-step">
          <div className="flex flex-col gap-1.5" data-component="employees-new-basic-name-field">
            <label htmlFor="employee-name" className={LABEL_CLS}>
              {t(locale, "employees.form.name")} <span className="text-v3-burgundy">*</span>
            </label>
            <input
              id="employee-name"
              className={INPUT_CLS}
              value={store.name}
              onChange={(event) => {
                setField("name", event.target.value);
                setError(null);
              }}
              placeholder="홍길동"
            />
          </div>

          <div className="flex flex-col gap-1.5" data-component="employees-new-basic-phone-field">
            <label htmlFor="employee-phone" className={LABEL_CLS}>
              {t(locale, "employees.form.phone")} <span className="text-v3-burgundy">*</span>
            </label>
            <input
              id="employee-phone"
              className={INPUT_CLS}
              value={store.phone}
              onChange={(event) => {
                setField("phone", formatPhoneNumber(event.target.value));
                setError(null);
              }}
              placeholder="010-1234-5678"
              maxLength={13}
            />
          </div>

          <div className="flex flex-col gap-1.5 md:col-span-2" data-component="employees-new-basic-grade-field">
            <label htmlFor="employee-grade" className={LABEL_CLS}>
              {t(locale, "employees.form.grade")} <span className="text-v3-burgundy">*</span>
            </label>
            <select
              id="employee-grade"
              className={SELECT_CLS}
              value={store.grade}
              onChange={(event) => {
                setField("grade", event.target.value);
                setError(null);
              }}
            >
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div
              data-component="employees-new-basic-error"
              className="md:col-span-2 text-[0.8rem] text-v3-burgundy font-semibold bg-v3-burgundy-light rounded-[14px] px-4 py-3"
            >
              {error}
            </div>
          )}
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap" data-component="employees-new-basic-summary">
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
          {store.grade && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {store.grade}
            </span>
          )}
        </div>
      ),
    },
    {
      label: t(locale, "employees.form.section-work"),
      content: (
        <div className="space-y-6" data-component="employees-new-work-step">
          <div className="flex flex-col gap-2" data-component="employees-new-work-area-field">
            <span className={LABEL_CLS}>
              {t(locale, "employees.form.work-area")} <span className="text-v3-burgundy">*</span>
            </span>

            <div data-component="employees-new-work-area-options" className="flex flex-wrap gap-3">
              {WORK_AREAS.map((area) => {
                const isSelected = store.workArea.includes(area);

                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => {
                      setField(
                        "workArea",
                        isSelected
                          ? store.workArea.filter((selectedArea) => selectedArea !== area)
                          : [...store.workArea, area]
                      );
                      setError(null);
                    }}
                    className={cn(
                      "px-4 py-2.5 rounded-[14px] text-[0.8rem] font-semibold transition-all border-[1.5px]",
                      isSelected
                        ? "bg-v3-primary-light border-v3-primary text-v3-primary"
                        : "bg-white border-v3-border text-v3-text-muted hover:border-v3-primary/40"
                    )}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 inline mr-1.5" strokeWidth={2.5} />}
                    {formatWorkAreaLabel(area)}
                  </button>
                );
              })}
            </div>
          </div>

          <div data-component="employees-new-open-status-field">
            <span className={cn(LABEL_CLS, "mb-3 block")}>
              {t(locale, "employees.form.open-to-next-work")}
            </span>
            <div data-component="employees-new-open-status-options" className="flex flex-wrap gap-3">
              {[
                { value: true, label: "가능" },
                { value: false, label: "불가" },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => setField("openToNextWork", option.value)}
                  className={cn(
                    "px-4 py-2.5 rounded-[14px] text-[0.8rem] font-semibold transition-all border-[1.5px]",
                    store.openToNextWork === option.value
                      ? "bg-v3-primary-light border-v3-primary text-v3-primary"
                      : "bg-white border-v3-border text-v3-text-muted hover:border-v3-primary/40"
                  )}
                >
                  {store.openToNextWork === option.value && (
                    <Check className="w-3.5 h-3.5 inline mr-1.5" strokeWidth={2.5} />
                  )}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div
              data-component="employees-new-work-error"
              className="text-[0.8rem] text-v3-burgundy font-semibold bg-v3-burgundy-light rounded-[14px] px-4 py-3"
            >
              {error}
            </div>
          )}
        </div>
      ),
      summary: (
        <div className="flex gap-3 flex-wrap" data-component="employees-new-work-summary">
          {store.workArea.map((area) => (
            <span key={area} className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
              {formatWorkAreaLabel(area)}
            </span>
          ))}
          <span className={COMPLETED_PILL}>
            <Check className="w-4 h-4 text-v3-green" strokeWidth={2} />
            {store.openToNextWork ? "근무 가능" : "근무 불가"}
          </span>
        </div>
      ),
    },
  ];

  return (
    <SteppedWizard
      title={t(locale, "employees.form.create-title")}
      subtitle="직원 정보를 단계별로 입력해 주세요"
      steps={steps}
      currentStep={currentStep}
      onStepChange={handleStepChange}
      onComplete={handleComplete}
      onBack={() => {
        reset();
        router.push(returnTo ?? "/employees");
      }}
      backLabel={returnTo ? "이전 화면으로 돌아가기" : "직원 목록으로 돌아가기"}
      completeLabel="등록"
      isSubmitting={createEmployee.isPending}
      className="min-h-full"
    />
  );
}
