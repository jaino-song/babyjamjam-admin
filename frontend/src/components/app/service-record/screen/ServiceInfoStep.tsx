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
    type ServiceRecordWizardSlots,
    type SlotMessage,
} from "@babyjamjam/service-record-ui";

import { OptionButtonGroup, ServiceRecordItemLabel, StickyActionBar } from "@/components/app/ui/service-record";
import { FormGrid } from "@/components/app/ui/form-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { HeaderFieldState } from "./headerFieldState";
import {
    BACK_LABEL,
    DELIVERY_TYPE_LABEL,
    DELIVERY_TYPE_OPTIONS,
    EMPLOYEE_FALLBACK_NAME,
    HEADER_FIELD_COMPONENT_SUFFIX,
    HEADER_SAVE_BUSY_LABEL,
    HEADER_SAVE_LABEL,
    ORG_FALLBACK_NAME,
    PROVIDER_EMPLOYEE_LABEL,
    PROVIDER_ORG_LABEL,
    SERVICE_TITLE,
    headerInputId,
    headerLabelId,
    headerSlotId,
} from "./ids";
import { ADMIN_MODE } from "./DayPageStep";

const SOURCE_COMPONENT = "ServiceInfoStep";

/** SRW:755 */
const FIELD_KEYS = ["momName", "momBirth", "babyName", "babyBirth", "deliveryType", "babyWeight"] as const;

const READONLY_ROW_CLASS =
    "flex min-h-[calc(38px*var(--glint-ui-scale,1))] min-w-0 items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] rounded-[13px] bg-v3-dim-white px-[calc(14px*var(--glint-ui-scale,1))] py-[calc(8px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text";

export type ServiceInfoStepProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "header"
    | "headerErrors"
    | "readOnly"
    | "busy"
    | "onBack"
    | "onHeaderChange"
    | "onDeliveryTypeChange"
    | "onSaveHeader"
> & {
    /** The step only renders with a loaded context (SRW:749). */
    context: NonNullable<ServiceRecordWizardProps["context"]>;
    /** The header fields' interaction state, owned by the screen root so it outlives this step (SRW:522-526, :534). */
    fieldState: HeaderFieldState;
    /** Replaces the save button inside the sticky bar (SRW:806-808). */
    adminHeaderAction?: ServiceRecordWizardSlots["adminHeaderAction"];
};

/**
 * The 기본정보 step of the admin editor (SRW:749-811 with `adminMode`). Fields sit in a
 * two-column grid from `sm`; messages are the package's own, resolved with
 * `adminMode`, and `headerErrors` (when supplied) owns the validation scope.
 * It renders its body and sticky action bar as siblings, so the parent must be the
 * screen's `min-h-dvh` column, which also owns the header.
 */
export function ServiceInfoStep({
    "data-component": root,
    context,
    header,
    headerErrors: suppliedHeaderErrors,
    readOnly = false,
    busy,
    onBack,
    onHeaderChange,
    onDeliveryTypeChange,
    onSaveHeader,
    fieldState,
    adminHeaderAction,
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
        adminMode: ADMIN_MODE,
        suppliedHeaderErrors,
        now: new Date(),
    });
    const headerFieldMessage = (key: ServiceRecordHeaderValidationKey): SlotMessage | null => getHeaderFieldMessage(key, {
        value: header[key] ?? "",
        hadValue: Boolean(hadHeaderValue[key]),
        touched: Boolean(touchedHeader[key]),
        focused: focusedHeader === key,
        submitted: headerSubmitted,
        adminMode: ADMIN_MODE,
        readOnly,
        suppliedHeaderErrors,
        headerErrors,
    });

    const handleHeaderInput = (key: ServiceRecordHeaderValidationKey, raw: string) => {
        onHeaderChange(key, HEADER_DATE_KEYS.includes(key) ? formatIsoDateInput(raw) : raw);
    };
    // SRW:652-661 - only the fallback save button uses this; the admin slot has its own handler.
    const handleSaveHeader = () => {
        if (readOnly || busy) return;
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
                className="flex min-w-0 flex-1 flex-col gap-[calc(14px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] sm:px-[calc(24px*var(--glint-ui-scale,1))]"
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
                <div
                    data-component={child("body_service-title")}
                    className="text-[calc(17px*var(--glint-ui-scale,1))] font-extrabold text-v3-dark"
                >
                    {SERVICE_TITLE}
                </div>
                <FormGrid data-component={child("body_fields")}>
                    {/* SRW:753-754 - not label rows: the message slot belongs to inputs. */}
                    <div data-component={child("body_readonly-row")} data-slot="ro" className={READONLY_ROW_CLASS}>
                        <span>{PROVIDER_EMPLOYEE_LABEL}</span>
                        <b>{context.employee?.name ?? EMPLOYEE_FALLBACK_NAME}</b>
                    </div>
                    <div data-component={child("body_readonly-row-2")} data-slot="ro" className={READONLY_ROW_CLASS}>
                        <span>{PROVIDER_ORG_LABEL}</span>
                        <b>{context.org?.name ?? ORG_FALLBACK_NAME}</b>
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
                                        disabled={readOnly}
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
                                    variant="v3"
                                    className="aria-[invalid=true]:border-v3-burgundy!"
                                    placeholder={field.ph}
                                    inputMode={field.inputMode}
                                    maxLength={HEADER_DATE_KEYS.includes(key) ? 10 : undefined}
                                    autoComplete="off"
                                    spellCheck={false}
                                    aria-required={!readOnly && !ADMIN_MODE}
                                    onFocus={() => setFocusedHeader(key)}
                                    onBlur={() => {
                                        setFocusedHeader(null);
                                        if (header[key]) touchHeader(key);
                                    }}
                                    value={header[key] ?? ""}
                                    disabled={readOnly}
                                    aria-invalid={message?.tone === "error" ? "true" : undefined}
                                    aria-describedby={slotId}
                                    onChange={(event) => handleHeaderInput(key, event.target.value)}
                                />
                            </div>
                        );
                    })}
                </FormGrid>
            </div>
            <StickyActionBar data-component={child("body_service-actions")}>
                {adminHeaderAction ? adminHeaderAction({ isHeaderComplete, headerErrors }) : (
                    <Button
                        type="button"
                        variant="positive"
                        data-component={child("body_service-save")}
                        disabled={readOnly || busy || (ADMIN_MODE && !isHeaderComplete)}
                        onClick={handleSaveHeader}
                    >
                        {busy ? HEADER_SAVE_BUSY_LABEL : HEADER_SAVE_LABEL}
                    </Button>
                )}
            </StickyActionBar>
        </>
    );
}
