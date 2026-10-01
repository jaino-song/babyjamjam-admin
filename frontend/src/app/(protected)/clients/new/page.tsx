"use client";
import { getUserErrorMessage } from "@babyjamjam/shared";
import { formatBirthdayInput, isValidBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import {
  isRealIsoDate,
  resolveFieldMessage,
  type FieldKind,
} from "@babyjamjam/shared/utils/field-validation-message";


import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft } from "lucide-react";
import {
  findOutOfPocketPriceInfo,
  formatOutOfPocketDurationLabel,
} from "@babyjamjam/shared";
import { useCreateClient } from "@/hooks/useClients";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos, useVoucherYears } from "@/hooks/useVoucherData";
import { api } from "@/lib/api/client";
import type { CreateClientDto, ServiceStatus } from "@/lib/client/types";
import { SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { EmployeeAutocomplete } from "@/components/app/clients/EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { FormField } from "@/components/auth/form-field";
import type { Employee } from "@/hooks/useEmployees";
import { SteppedWizard } from "@/components/app/v3";
import type { WizardStep } from "@/components/app/v3";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import {
  resolveElevenDigitPhoneMessage,
  toFieldMessageView,
  type FieldMessageView,
} from "@/lib/forms/field-message-text";
import { useClientWizardStore } from "@/stores/client-wizard-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { useNavigationPending } from "@/lib/hooks/use-navigation-pending";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { FieldMessageText } from "@/components/app/ui/field-message";
import { FormField as AppFormField, FormNativeSelect, FormTextInputWithSuffix } from "@/components/app/ui/form-section";
import { TogglePill } from "@/components/app/ui/toggle-pill";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "h-auto w-full rounded-[14px] border-[1.5px] border-input bg-white px-4 py-3 text-[0.85rem] font-[Pretendard] text-dark outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]";

const SELECT_CLS =
  "h-auto min-h-0 w-full rounded-[14px] border-[1.5px] border-input bg-white pl-4 py-3 text-[0.85rem] font-normal leading-normal text-dark outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)] focus:ring-0";

const LABEL_CLS = "text-xs font-semibold text-text-muted";

const GRID_CLS = "grid grid-cols-1 md:grid-cols-2 gap-4";

const COMPLETED_PILL =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-[14px] bg-green-light border-[1.5px] border-[hsl(137,40%,85%)] text-[0.85rem] font-semibold text-dark";

type ClientInputField =
  | "name"
  | "birthday"
  | "dueDate"
  | "birthDate"
  | "phone"
  | "address"
  | "startDate"
  | "endDate";

const CLIENT_INPUT_FIELD_CONFIG: Record<ClientInputField, {
  kind: FieldKind;
  required: boolean;
  labelKey: string;
  step: number;
}> = {
  name: { kind: "text", required: true, labelKey: "clients.form.name", step: 0 },
  birthday: { kind: "date", required: false, labelKey: "clients.form.birthday", step: 0 },
  dueDate: { kind: "date", required: false, labelKey: "clients.form.due-date", step: 0 },
  birthDate: { kind: "date", required: false, labelKey: "clients.form.birth-date", step: 0 },
  phone: { kind: "phone", required: true, labelKey: "clients.form.phone", step: 0 },
  address: { kind: "text", required: false, labelKey: "clients.form.address", step: 0 },
  startDate: { kind: "date", required: false, labelKey: "clients.form.start-date", step: 2 },
  endDate: { kind: "date", required: false, labelKey: "clients.form.end-date", step: 2 },
};

/** Listed in form order: the first one with a problem receives focus on submit. */
const CLIENT_INPUT_FIELDS = Object.keys(CLIENT_INPUT_FIELD_CONFIG) as ClientInputField[];

const clientInputElementId = (field: ClientInputField) => `clients-new-${field}`;

const PHONE_DUPLICATE_CHECK_MAX_RETRIES = 3;
const PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS = 1000;

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

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
  locale === "ko"
    ? "문제가 발생했어요. 새로고침 해주세요."
    : "Something went wrong. Please refresh and try again.";

export default function NewClientPage() {
  const router = useRouter();
  const locale = useLocale();
  const createClient = useCreateClient();
  const { isPending: isSubmitting, beginNavigation } = useNavigationPending(createClient.isPending);
  const prefillName = useClientDialogStore((s) => s.prefillName);
  const clearPrefillName = useClientDialogStore((s) => s.clearPrefillName);

  const store = useClientWizardStore();
  const { currentStep, pricesManuallyEdited, voucherYear, setField, setCurrentStep, setPricesManuallyEdited, setVoucherYear, reset } = store;

  const [error, setError] = useState<string | null>(null);
  const fields = useFieldInputStates<ClientInputField>();
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);
  const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
  const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);
  const [hasPhoneDuplicateCheckFailed, setHasPhoneDuplicateCheckFailed] = useState(false);
  const [lastCheckedPhoneDigits, setLastCheckedPhoneDigits] = useState<string | null>(null);

  const phoneDigits = useMemo(() => store.phone.replace(/\D/g, ""), [store.phone]);
  // Duplicate-check status for the phone field's label-row slot: a failed
  // check or duplicate is an error, a check still running is a hint.
  const phoneInlineMessage: FieldMessageView | null = phoneDigits.length === 11
    ? hasPhoneDuplicateCheckFailed
      ? { tone: "error", text: getPhoneDuplicateCheckFailedMessage(locale) }
      : isCheckingPhoneDuplicate || lastCheckedPhoneDigits !== phoneDigits
        ? { tone: "hint", text: t(locale, "form.validation.phone-checking") }
        : isPhoneDuplicate
          ? { tone: "error", text: t(locale, "clients.form.error-phone-duplicate") }
          : null
    : null;

  useEffect(() => {
    if (prefillName) {
      setField("name", prefillName);
      clearPrefillName();
    }
  }, [prefillName, clearPrefillName, setField]);

  // Voucher year selection - defaults to the year the service belongs to (the
  // form's service end date), then the current year when no end date is set.
  // Either case falls back to the latest server-provided year when the year
  // isn't in the list.
  const { data: voucherYears = [] } = useVoucherYears();
  const resolvedVoucherYear = useMemo(() => {
    if (voucherYear !== null) return voucherYear;
    const endDateYear = isRealIsoDate(store.endDate) ? Number.parseInt(store.endDate.slice(0, 4), 10) : NaN;
    if (Number.isFinite(endDateYear) && (voucherYears.length === 0 || voucherYears.includes(endDateYear))) {
      return endDateYear;
    }
    const currentYear = new Date().getFullYear();
    if (voucherYears.length === 0 || voucherYears.includes(currentYear)) return currentYear;
    return Math.max(...voucherYears);
  }, [voucherYear, voucherYears, store.endDate]);

  const voucherYearOptions = useMemo(
    () => voucherYears.map((year) => ({ value: String(year), label: `${year}년` })),
    [voucherYears]
  );

  const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(store.type || "", resolvedVoucherYear);
  const {
    data: outOfPocketPriceInfos,
    isLoading: isOutOfPocketPriceLoading,
    isError: isOutOfPocketPriceError,
  } = useOutOfPocketPriceInfos();

  const availableDurations = useMemo(() => {
    if (!voucherPriceInfos) return [];
    const durations = [...new Set(voucherPriceInfos.map((i) => Number(i.duration)))];
    return durations.sort((a, b) => a - b);
  }, [voucherPriceInfos]);

  const selectedPriceInfo = useMemo(() => {
    if (!store.voucherClient) {
      return findOutOfPocketPriceInfo(outOfPocketPriceInfos, store.duration);
    }
    if (!voucherPriceInfos || !store.duration) return null;
    return voucherPriceInfos.find((i) => Number(i.duration) === store.duration);
  }, [outOfPocketPriceInfos, store.duration, store.voucherClient, voucherPriceInfos]);

  const durationOptions = useMemo(() => {
    if (!store.voucherClient) {
      return (outOfPocketPriceInfos ?? []).map((priceInfo) => ({
        value: String(priceInfo.duration),
        label: formatOutOfPocketDurationLabel(priceInfo.duration),
      }));
    }

    return availableDurations.map((duration) => ({ value: String(duration), label: `${duration}일` }));
  }, [availableDurations, outOfPocketPriceInfos, store.voucherClient]);

  const arePriceInputsLocked = store.voucherClient
    ? !store.type || !store.duration || isPriceLoading
    : !store.duration || isOutOfPocketPriceLoading || isOutOfPocketPriceError;

  useEffect(() => {
    if (selectedPriceInfo && !pricesManuallyEdited) {
      setField("fullPrice", parsePrice(selectedPriceInfo.fullPrice));
      if (store.voucherClient && "grant" in selectedPriceInfo && "actualPrice" in selectedPriceInfo) {
        setField("grant", parsePrice(selectedPriceInfo.grant));
        setField("actualPrice", parsePrice(selectedPriceInfo.actualPrice));
      } else {
        setField("grant", "0");
        setField("actualPrice", parsePrice(selectedPriceInfo.fullPrice));
      }
    }
  }, [selectedPriceInfo, pricesManuallyEdited, setField, store.voucherClient]);

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

  const handleTypeChange = (newType: string) => {
    setField("type", newType);
    setField("duration", null);
    if (!pricesManuallyEdited) {
      setField("fullPrice", "");
      setField("grant", "");
      setField("actualPrice", "");
    }
  };

  const handleVoucherYearChange = (newYear: string) => {
    const parsedYear = Number(newYear);
    setVoucherYear(Number.isNaN(parsedYear) ? null : parsedYear);
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

  const handleVoucherClientChange = (voucherClient: boolean) => {
    setPricesManuallyEdited(false);
    setField("voucherClient", voucherClient);
    setField("type", "");
    setField("duration", null);
    setField("fullPrice", "");
    setField("grant", "");
    setField("actualPrice", "");
  };

  const inputValueOf = (field: ClientInputField): string => store[field];

  const handleInputChange = (field: ClientInputField, value: string) => {
    fields.onChange(field, inputValueOf(field), value);
    setField(field, value);
    setError(null);
  };

  /**
   * The one message a text input shows in its label-row slot. `settled`
   * evaluates only the input's own rules as if the user already left the
   * field and pressed next, which is how a step decides whether the field has
   * a problem. Duplicate-check status is not a rule of the input.
   */
  const resolveInputMessage = (field: ClientInputField, settled = false): FieldMessageView | null => {
    const { kind, required, labelKey } = CLIENT_INPUT_FIELD_CONFIG[field];
    const value = inputValueOf(field);
    // Whitespace alone does not count as a value for free text.
    const baseState = fields.stateOf(field, kind === "text" ? value.trim() : value);
    const state = settled ? { ...baseState, focused: false } : baseState;
    const opts = {
      required,
      submitted: settled || fields.submitted,
      ...(field === "endDate" ? { dateRange: { notBefore: store.startDate } } : {}),
    };

    const formatMessage = toFieldMessageView(
      locale,
      field === "phone" ? resolveElevenDigitPhoneMessage(state, opts) : resolveFieldMessage(kind, state, opts),
      t(locale, labelKey),
    );
    if (formatMessage) return formatMessage;

    if (field === "birthday" && value.length === 10 && !isValidBirthdayIsoDate(value)) {
      return { tone: "error", text: t(locale, "form.validation.birthday-future") };
    }
    if (!settled && field === "phone" && phoneInlineMessage) return phoneInlineMessage;
    return null;
  };

  /** Message slot, focus tracking and element id shared by every inline-validated input. */
  const getInputFieldProps = (field: ClientInputField) => ({
    id: clientInputElementId(field),
    message: resolveInputMessage(field),
    ...fields.focusProps(field, inputValueOf(field)),
  });

  const validateStep = (step: number): boolean => {
    fields.setSubmitted(true);
    const firstProblemField = CLIENT_INPUT_FIELDS.find(
      (field) => CLIENT_INPUT_FIELD_CONFIG[field].step === step
        && resolveInputMessage(field, true)?.tone === "error",
    );
    if (firstProblemField) {
      document.getElementById(clientInputElementId(firstProblemField))?.focus();
      return false;
    }
    switch (step) {
      case 0:
        if (phoneDigits.length === 11) {
          // A pending, failed or duplicate check already shows in the phone slot.
          if (
            isCheckingPhoneDuplicate
            || lastCheckedPhoneDigits !== phoneDigits
            || hasPhoneDuplicateCheckFailed
            || isPhoneDuplicate
          ) {
            document.getElementById(clientInputElementId("phone"))?.focus();
            return false;
          }
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
        birthDate: store.birthDate || null,
        address: store.address || null,
        phone: store.phone || null,
        primaryEmployeeId: store.primaryEmployeeId,
        secondaryEmployeeId: store.secondaryEmployeeId,
        type: store.voucherClient ? store.type || null : null,
        duration: store.duration || null,
        fullPrice: store.fullPrice || null,
        grant: store.voucherClient ? store.grant || null : "0",
        actualPrice: store.voucherClient ? store.actualPrice || null : store.fullPrice || null,
        startDate: store.startDate || null,
        endDate: store.endDate || null,
        careCenter: store.careCenter,
        voucherClient: store.voucherClient,
        breastPump: store.breastPump,
        serviceStatus: store.serviceStatus || null,
        applyMessageAutomation: store.applyMessageAutomation,
      };
      const newClient = await createClient.mutateAsync(dto);
      reset();
      beginNavigation();
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
      summaryTitle: store.name || undefined,
      content: (
        <div data-component="desktop_clients-new_basic_step" className={GRID_CLS}>
          <div data-component="desktop_clients-new_basic_step_name-field">
            <FormField
              label={t(locale, "clients.form.name")}
              required
              type="text"
              value={store.name}
              onChange={(e) => handleInputChange("name", e.target.value)}
              placeholder="홍길동"
              {...getInputFieldProps("name")}
            />
          </div>
          <div data-component="desktop_clients-new_basic_step_birthday-field">
            <FormField
              label={t(locale, "clients.form.birthday")}
              type="text"
              value={store.birthday}
              onChange={(e) => handleInputChange("birthday", formatBirthdayInput(e.target.value))}
              inputMode="numeric"
              placeholder="1958-03-03"
              maxLength={10}
              {...getInputFieldProps("birthday")}
            />
          </div>
          <div data-component="desktop_clients-new_basic_step_due-date-field">
            <FormField
              label={t(locale, "clients.form.due-date")}
              type="text"
              value={store.dueDate}
              onChange={(e) => handleInputChange("dueDate", formatIsoDateInput(e.target.value))}
              inputMode="numeric"
              placeholder="2026-11-20"
              maxLength={10}
              {...getInputFieldProps("dueDate")}
            />
          </div>
          <div data-component="desktop_clients-new_basic_step_birth-date-field">
            <FormField
              label={t(locale, "clients.form.birth-date")}
              type="text"
              value={store.birthDate}
              onChange={(e) => handleInputChange("birthDate", formatIsoDateInput(e.target.value))}
              inputMode="numeric"
              placeholder="2026-11-20"
              maxLength={10}
              {...getInputFieldProps("birthDate")}
            />
          </div>
          <div data-component="desktop_clients-new_basic_step_phone-field">
            <FormField
              label={t(locale, "clients.form.phone")}
              required
              type="tel"
              value={store.phone}
              onChange={(e) => handleInputChange("phone", formatKoreanPhoneNumber(e.target.value))}
              inputMode="numeric"
              placeholder="010-1234-5678"
              maxLength={20}
              {...getInputFieldProps("phone")}
            />
          </div>
          <div data-component="desktop_clients-new_basic_step_address-field" className="md:col-span-2">
            <FormField
              label={t(locale, "clients.form.address")}
              type="text"
              value={store.address}
              onChange={(e) => handleInputChange("address", e.target.value)}
              placeholder="서울시 강남구..."
              {...getInputFieldProps("address")}
            />
          </div>
          {error && (
            <div data-component="desktop_clients-new_basic_step_error" className="md:col-span-2 text-[0.8rem] text-burgundy font-semibold bg-burgundy-light rounded-[14px] px-4 py-3">
              {error}
            </div>
          )}
        </div>
      ),
    },
    {
      label: "서비스 설정",
      content: (
        <div data-component="desktop_clients-new_service_step" className="space-y-6">
          <div data-component="desktop_clients-new_service_step_voucher-toggle" className="flex justify-center">
            <TogglePill
              value={store.voucherClient}
              onValueChange={handleVoucherClientChange}
              leftLabel={t(locale, "clients.form.voucher-client")}
              rightLabel={t(locale, "clients.form.self-pay-client")}
              ariaLabel={t(locale, "clients.form.customer-type")}
            />
          </div>

          <div data-component="desktop_clients-new_service_step_grid" className={GRID_CLS}>
            {store.voucherClient && <AppFormField
              data-component="desktop_clients-new_service_step_grid_year-field"
              htmlFor="clients-new-voucher-year"
              label={t(locale, "clients.form.voucher-year")}
            >
              <FormNativeSelect
                id="clients-new-voucher-year"
                className={SELECT_CLS}
                value={resolvedVoucherYear.toString()}
                onValueChange={handleVoucherYearChange}
                options={voucherYearOptions}
              />
            </AppFormField>}
            {store.voucherClient && <AppFormField
              data-component="desktop_clients-new_service_step_grid_type-field"
              htmlFor="clients-new-voucher-type"
              label={t(locale, "clients.form.voucher-type")}
            >
              <FormNativeSelect
                id="clients-new-voucher-type"
                className={SELECT_CLS}
                value={store.type}
                onValueChange={handleTypeChange}
                options={[
                  { value: "", label: "선택하세요" },
                  ...Object.entries(voucherOptions.voucherOptions).flatMap(([groupName, types]) =>
                    Object.entries(types).map(([typeValue, typeData]) => ({
                      value: typeValue,
                      label: `${groupName} — ${typeData.label}`,
                    })),
                  ),
                ]}
              />
            </AppFormField>}
            <AppFormField
              data-component="desktop_clients-new_service_step_grid_duration-field"
              htmlFor="clients-new-duration"
              label={t(locale, "clients.form.duration")}
              labelAccessory={!store.voucherClient && isOutOfPocketPriceError ? (
                <FieldMessageText
                  id="clients-new-duration-message"
                  tone="error"
                  data-component="desktop_clients-new_service_step_grid_duration-field_message"
                >
                  자부담 요금을 불러오지 못했어요
                </FieldMessageText>
              ) : null}
            >
              <div data-component="desktop_clients-new_service_step_grid_duration-field_duration-select-wrap" className="relative">
                <FormNativeSelect
                  id="clients-new-duration"
                  className={cn(SELECT_CLS, (store.voucherClient
                    ? !store.type || isPriceLoading
                    : isOutOfPocketPriceLoading || isOutOfPocketPriceError) && "opacity-50")}
                  value={store.duration?.toString() || ""}
                  onValueChange={(value) => {
                    setField("duration", value ? Number(value) : null);
                    setPricesManuallyEdited(false);
                  }}
                  disabled={store.voucherClient
                    ? !store.type || isPriceLoading
                    : isOutOfPocketPriceLoading || isOutOfPocketPriceError}
                  aria-describedby={!store.voucherClient && isOutOfPocketPriceError ? "clients-new-duration-message" : undefined}
                  options={[
                    { value: "", label: "선택하세요" },
                    ...durationOptions,
                  ]}
                />
                {(store.voucherClient ? isPriceLoading : isOutOfPocketPriceLoading) && (
                  <div data-component="desktop_clients-new_service_step_grid_duration-field_duration-select-wrap_duration-loading" className="absolute right-10 top-1/2 -translate-y-1/2">
                    <div data-component="desktop_clients-new_service_step_grid_duration-field_duration-select-wrap_duration-loading_duration-spinner" className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </AppFormField>
          </div>

          <div data-component="desktop_clients-new_service_step_employee-grid" className={GRID_CLS}>
            <div data-component="desktop_clients-new_service_step_employee-grid_primary-employee-field">
              <EmployeeAutocomplete
                  data-component="desktop_clients-new_service_step_employee-grid_primary-employee-field_autocomplete"
                value={store.primaryEmployeeId}
                onChange={(id) => setField("primaryEmployeeId", id)}
                label={t(locale, "clients.form.primary-employee")}
                excludeIds={store.secondaryEmployeeId != null ? [store.secondaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                  setEmployeeDialogTarget("primary");
                  setIsEmployeeDialogOpen(true);
                }}
              />
            </div>
            <div data-component="desktop_clients-new_service_step_employee-grid_secondary-employee-field">
              <EmployeeAutocomplete
                  data-component="desktop_clients-new_service_step_employee-grid_secondary-employee-field_autocomplete"
                value={store.secondaryEmployeeId}
                onChange={(id) => setField("secondaryEmployeeId", id)}
                label={t(locale, "clients.form.secondary-employee")}
                excludeIds={store.primaryEmployeeId != null ? [store.primaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                  setEmployeeDialogTarget("secondary");
                  setIsEmployeeDialogOpen(true);
                }}
              />
            </div>
          </div>

          <div data-component="desktop_clients-new_service_step_pricing-section">
            <div data-component="desktop_clients-new_service_step_pricing-section_pricing-header" className="flex items-center gap-2 mb-3">
              <span className={LABEL_CLS}>{t(locale, "clients.form.section-pricing")}</span>
              {selectedPriceInfo && !pricesManuallyEdited && (
                <span className="text-[0.65rem] font-bold text-primary bg-primary-light px-2 py-0.5 rounded-full">
                  자동입력
                </span>
              )}
            </div>
            <div data-component="desktop_clients-new_service_step_pricing-section_pricing-grid" className={cn("grid grid-cols-1 gap-4", store.voucherClient && "md:grid-cols-3")}>
              <AppFormField
                data-component="desktop_clients-new_service_step_pricing-section_pricing-grid_full-price-field"
                htmlFor="clients-new-full-price"
                label={t(locale, "clients.form.full-price")}
              >
                <FormTextInputWithSuffix
                  data-component="desktop_clients-new_service_step_pricing-section_pricing-grid_full-price-field_full-price-input-wrap"
                  id="clients-new-full-price"
                  value={arePriceInputsLocked ? "" : formatPrice(store.fullPrice)}
                  onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                  disabled={arePriceInputsLocked}
                  className={INPUT_CLS}
                  placeholder="0"
                  suffix="원"
                />
              </AppFormField>
              {store.voucherClient && <AppFormField
                data-component="desktop_clients-new_service_step_pricing-section_pricing-grid_grant-field"
                htmlFor="clients-new-grant"
                label={t(locale, "clients.form.grant")}
              >
                <FormTextInputWithSuffix
                  data-component="desktop_clients-new_service_step_pricing-section_pricing-grid_grant-field_grant-input-wrap"
                  id="clients-new-grant"
                  value={formatPrice(store.grant)}
                  onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                  className={INPUT_CLS}
                  placeholder="0"
                  suffix="원"
                />
              </AppFormField>}
              {store.voucherClient && <AppFormField
                data-component="desktop_clients-new_service_step_pricing-section_pricing-grid_actual-price-field"
                htmlFor="clients-new-actual-price"
                label={t(locale, "clients.form.actual-price")}
              >
                <FormTextInputWithSuffix
                  data-component="desktop_clients-new_service_step_pricing-section_pricing-grid_actual-price-field_actual-price-input-wrap"
                  id="clients-new-actual-price"
                  value={formatPrice(store.actualPrice)}
                  onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                  className={INPUT_CLS}
                  placeholder="0"
                  suffix="원"
                />
              </AppFormField>}
            </div>
          </div>

          <div data-component="desktop_clients-new_service_step_flags-field">
            <span className={cn(LABEL_CLS, "mb-3 block")}>{t(locale, "clients.form.section-flags")}</span>
            <div data-component="desktop_clients-new_service_step_flags-field_flags-options" className="flex flex-wrap gap-3">
              {([
                { key: "careCenter" as const, label: t(locale, "clients.form.care-center") },
                { key: "breastPump" as const, label: t(locale, "clients.form.breast-pump") },
                { key: "applyMessageAutomation" as const, label: t(locale, "clients.form.message-automation") },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  data-component={`desktop_clients-new_service_flags-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-chip`}
                  type="button"
                  onClick={() => setField(key, !store[key])}
                  className={cn(
                    "px-4 py-2.5 rounded-[14px] text-[0.8rem] font-semibold transition-all border-[1.5px]",
                    store[key]
                      ? "bg-primary-light border-primary text-primary"
                      : "bg-white border-border text-text-muted hover:border-primary/40"
                  )}
                >
                  {store[key] && <Check className="w-3.5 h-3.5 inline mr-1.5" strokeWidth={2.5} />}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div data-component="desktop_clients-new_service_step_error" className="text-[0.8rem] text-burgundy font-semibold bg-burgundy-light rounded-[14px] px-4 py-3">
              {error}
            </div>
          )}
        </div>
      ),
      summary: (
        <div data-component="desktop_clients-new_service_summary" className="flex gap-3 flex-wrap">
          {store.type && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-green" strokeWidth={2} />
              {store.type}
            </span>
          )}
          {store.duration && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-green" strokeWidth={2} />
              {store.duration}일
            </span>
          )}
          {store.actualPrice && (
            <span className={COMPLETED_PILL}>
              <Check className="w-4 h-4 text-green" strokeWidth={2} />
              {formatPrice(store.actualPrice)}원
            </span>
          )}
        </div>
      ),
    },
    {
      label: "계약 정보",
      content: (
        <div data-component="desktop_clients-new_contract_step" className="space-y-6">
          <div data-component="desktop_clients-new_contract_step_grid" className={GRID_CLS}>
            <AppFormField
              data-component="desktop_clients-new_contract_step_grid_status-field"
              htmlFor="clients-new-contract-status"
              label={t(locale, "clients.form.contract-status")}
            >
              <FormNativeSelect
                id="clients-new-contract-status"
                className={SELECT_CLS}
                value={store.serviceStatus}
                onValueChange={(value) => setField("serviceStatus", value as ServiceStatus)}
                options={SERVICE_STATUS_OPTIONS}
              />
            </AppFormField>
            <div data-component="desktop_clients-new_contract_step_grid_spacer" />
            <div data-component="desktop_clients-new_contract_step_grid_start-date-field">
              <FormField
                label={t(locale, "clients.form.start-date")}
                type="text"
                value={store.startDate}
                onChange={(e) => handleInputChange("startDate", formatIsoDateInput(e.target.value))}
                inputMode="numeric"
                placeholder="2026-12-01"
                maxLength={10}
                {...getInputFieldProps("startDate")}
              />
            </div>
            <div data-component="desktop_clients-new_contract_step_grid_end-date-field">
              <FormField
                label={t(locale, "clients.form.end-date")}
                type="text"
                value={store.endDate}
                onChange={(e) => handleInputChange("endDate", formatIsoDateInput(e.target.value))}
                inputMode="numeric"
                placeholder="2026-12-19"
                maxLength={10}
                {...getInputFieldProps("endDate")}
              />
            </div>
          </div>

          {error && (
            <div data-component="desktop_clients-new_contract_step_error" className="text-[0.8rem] text-burgundy font-semibold bg-burgundy-light rounded-[14px] px-4 py-3">
              {error}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div data-component="desktop_clients-new_main_content" className="flex min-h-[calc(100dvh-6rem)] items-start justify-center py-6 md:py-8">
        <div data-component="desktop_clients-new_main_content_content-inner" className="flex w-full flex-col">
          <button
            data-component="desktop_clients-new_main_content_content-inner_back-button"
            type="button"
            onClick={() => router.push("/clients")}
            className="inline-flex items-center gap-1.5 text-[0.85rem] md:text-[0.85rem] text-[0.8rem] font-semibold text-text-muted hover:text-primary transition-colors mb-4 md:mb-6 self-start"
          >
            <ChevronLeft className="w-5 h-5 md:w-5 md:h-5 w-[18px] h-[18px]" />
            고객 목록으로 돌아가기
          </button>

          <div data-component="desktop_clients-new_main_content_content-inner_shell">
            <SteppedWizard
              title={t(locale, "clients.form.add-title")}
              subtitle="고객 정보를 단계별로 입력해 주세요"
              steps={steps}
              currentStep={currentStep}
              onStepChange={handleStepChange}
              onComplete={handleComplete}
              completeLabel="등록"
              isSubmitting={isSubmitting}
              isNextDisabled={
                currentStep === 0 &&
                phoneDigits.length === 11 &&
                (
                  isCheckingPhoneDuplicate ||
                  hasPhoneDuplicateCheckFailed ||
                  isPhoneDuplicate ||
                  lastCheckedPhoneDigits !== phoneDigits
                )
              }
            />
          </div>
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
