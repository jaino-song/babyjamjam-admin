"use client";

import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import {
    HEADER_DATE_KEYS,
    HEADER_FIELDS,
    firstHeaderProblemKey,
    focusFirstProblem,
    getHeaderFieldMessage,
    resolveHeaderErrors,
    type ServiceRecordHeaderValidationKey,
    type ServiceRecordWizardProps,
    type SlotMessage,
} from "@babyjamjam/service-record-ui";

import { Input } from "@/components/app/v3/Input";
import { OptionButtonGroup } from "@/components/app/v3/OptionButtonGroup";
import { ServiceRecordItemLabel } from "@/components/app/v3/ServiceRecordItemLabel";
import { StickyActionBar } from "@/components/app/v3/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DEFAULT_PROVIDER_NAME } from "@/components/service-record/provider-info";

import {
    BACK_LABEL,
    DELIVERY_TYPE_LABEL,
    DELIVERY_TYPE_OPTIONS,
    EMPLOYEE_FALLBACK_NAME,
    HEADER_FIELD_COMPONENT_SUFFIX,
    NEXT_LABEL,
    PROVIDER_EMPLOYEE_LABEL,
    PROVIDER_ORG_LABEL,
    SERVICE_SAVE_BUSY_LABEL,
    SERVICE_TITLE,
    headerInputId,
    headerLabelId,
    headerSlotId,
} from "./ids";
import type { HeaderFieldState } from "./fieldInteractionState";

const SOURCE_COMPONENT = "ServiceInfoStep";

const FIELD_KEYS = ["momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight"] as const;

const READONLY_ROW_CLASS = "flex min-h-11 items-center justify-between gap-3 rounded-[12px] bg-v3-dim-white px-3.5 py-2 text-sm text-v3-text";

export type ServiceInfoStepProps = Pick<
    ServiceRecordWizardProps,
    "data-component" | "header" | "busy" | "onBack" | "onHeaderChange" | "onDeliveryTypeChange" | "onSaveHeader"
> & {
    /** The step only renders with a loaded context (SRW:749). */
    context: NonNullable<ServiceRecordWizardProps["context"]>;
    /** The header fields' interaction state, owned by the screen root so it outlives this step (SRW:523-525, :534). */
    fieldState: HeaderFieldState;
};

/**
 * The service basic-information step (SRW:749-811 with `readOnly` and `adminMode`
 * false).
 */
export function ServiceInfoStep({
    "data-component": root,
    context,
    header,
    busy,
    onBack,
    onHeaderChange,
    onDeliveryTypeChange,
    onSaveHeader,
    fieldState,
}: ServiceInfoStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const {
        touched: touchedHeader,
        touch: touchHeader,
        focused: focusedHeader,
        setFocused: setFocusedHeader,
        submitted: headerSubmitted,
        setSubmitted: setHeaderSubmitted,
        hadValue: hadHeaderValue,
    } = fieldState;
    const { headerErrors, isHeaderComplete } = resolveHeaderErrors(header, {
        adminMode: false,
        suppliedHeaderErrors: undefined,
        now: new Date(),
    });
    const headerFieldMessage = (key: ServiceRecordHeaderValidationKey): SlotMessage | null => getHeaderFieldMessage(key, {
        value: header[key] ?? "",
        hadValue: Boolean(hadHeaderValue[key]),
        touched: Boolean(touchedHeader[key]),
        focused: focusedHeader === key,
        submitted: headerSubmitted,
        adminMode: false,
        readOnly: false,
        suppliedHeaderErrors: undefined,
        headerErrors,
    });

    const handleHeaderInput = (key: ServiceRecordHeaderValidationKey, raw: string) => {
        onHeaderChange(key, HEADER_DATE_KEYS.includes(key) ? formatIsoDateInput(raw) : raw);
    };
    // Employees can press "다음" any time: a blocked press shows every problem in its slot.
    const handleSaveHeader = () => {
        if (busy) return;
        setHeaderSubmitted(true);
        if (isHeaderComplete) {
            void onSaveHeader();
            return;
        }
        const firstProblem = firstHeaderProblemKey(headerErrors);
        focusFirstProblem(firstProblem ? headerInputId(firstProblem) : null);
    };

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-3.5 px-4 pb-6 pt-4"
            >
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-component={child("body_service-back")}
                    className="-ml-3 self-start text-v3-text-muted"
                    onClick={onBack}
                >
                    {BACK_LABEL}
                </Button>
                <div data-component={child("body_service-title")} className="text-lg font-bold text-v3-dark">
                    {SERVICE_TITLE}
                </div>
                <div data-component={child("body_readonly-row")} data-slot="ro" className={READONLY_ROW_CLASS}>
                    <span>{PROVIDER_EMPLOYEE_LABEL}</span>
                    <b>{context.employee?.name ?? EMPLOYEE_FALLBACK_NAME}</b>
                </div>
                <div data-component={child("body_readonly-row-2")} data-slot="ro" className={READONLY_ROW_CLASS}>
                    <span>{PROVIDER_ORG_LABEL}</span>
                    <b>{context.org?.name ?? DEFAULT_PROVIDER_NAME}</b>
                </div>
                {FIELD_KEYS.map((key) => {
                    const inputId = headerInputId(key);
                    const slotId = headerSlotId(key);
                    const labelId = headerLabelId(key);
                    const message = headerFieldMessage(key);
                    if (key === "deliveryType") {
                        const deliveryComponent = child("body_delivery-field_options");
                        return (
                            <div data-component={child("body_delivery-field")} className="min-w-0" key={key}>
                                <ServiceRecordItemLabel
                                    data-component={`${deliveryComponent}_label-row`}
                                    labelId={labelId}
                                    label={DELIVERY_TYPE_LABEL}
                                    messageId={slotId}
                                    message={message}
                                />
                                <OptionButtonGroup
                                    data-component={deliveryComponent}
                                    mode="single"
                                    labelledBy={labelId}
                                    options={DELIVERY_TYPE_OPTIONS.map((option) => ({ value: option, label: option }))}
                                    selected={header.deliveryType ? [header.deliveryType] : []}
                                    onToggle={(value) => {
                                        touchHeader("deliveryType");
                                        onDeliveryTypeChange(value);
                                    }}
                                    firstOptionId={inputId}
                                    describedBy={slotId}
                                    invalid={message?.tone === "error"}
                                />
                            </div>
                        );
                    }
                    const field = HEADER_FIELDS.find((candidate) => candidate.k === key);
                    if (!field) return null;
                    const inputComponent = key === "babyWeight"
                        ? child("body_field-2_baby-weight-input")
                        : child(`body_field_${HEADER_FIELD_COMPONENT_SUFFIX[key]}-input`);
                    return (
                        <div data-component={inputComponent} className="min-w-0" key={key}>
                            <ServiceRecordItemLabel
                                data-component={`${inputComponent}_label-row`}
                                labelId={labelId}
                                label={field.label}
                                htmlFor={inputId}
                                messageId={slotId}
                                message={message}
                            />
                            <Input
                                id={inputId}
                                data-component={`${inputComponent}_control`}
                                className="text-base focus-visible:border-v3-primary! aria-[invalid=true]:border-v3-burgundy!"
                                placeholder={field.ph}
                                inputMode={field.inputMode}
                                maxLength={HEADER_DATE_KEYS.includes(key) ? 10 : undefined}
                                autoComplete="off"
                                spellCheck={false}
                                aria-required
                                onFocus={() => setFocusedHeader(key)}
                                onBlur={() => {
                                    setFocusedHeader(null);
                                    if (header[key]) touchHeader(key);
                                }}
                                value={header[key] ?? ""}
                                aria-invalid={message?.tone === "error" ? "true" : undefined}
                                aria-describedby={slotId}
                                onChange={(event) => handleHeaderInput(key, event.target.value)}
                            />
                        </div>
                    );
                })}
            </div>
            <StickyActionBar data-component={child("body_service-actions")}>
                <Button
                    type="button"
                    variant="v3"
                    size="md"
                    data-component={child("body_service-next")}
                    disabled={busy}
                    onClick={handleSaveHeader}
                >
                    {busy ? <><Spinner size="sm" aria-hidden="true" />{SERVICE_SAVE_BUSY_LABEL}</> : NEXT_LABEL}
                </Button>
            </StickyActionBar>
        </>
    );
}
