"use client";

import { useState } from "react";
import {
    getDailyItemMessages,
    useHadValue,
    type DailyItem,
    type ServiceRecordNumericErrors,
} from "@babyjamjam/service-record-ui";

import { CountUnitField, CountUnitFieldRow } from "@/components/app/v3/CountUnitField";
import { Input } from "@/components/app/v3/Input";
import { OptionButtonGroup } from "@/components/app/v3/OptionButtonGroup";
import { ServiceRecordItemLabel } from "@/components/app/v3/ServiceRecordItemLabel";
import { Textarea } from "@/components/ui/textarea";

import {
    CONFIRM_OPTION_LABEL,
    STOOL_ABNORMAL_OPTION,
    STOOL_COLOR_LABEL,
    STOOL_COLOR_PLACEHOLDER,
    countAccessibleName,
    countInputId,
    countPlaceholder,
    dailyItemLabelId,
    dailyItemSlotId,
    firstOptionIdOf,
    stoolColorInputId,
    stoolColorSlotId,
    textareaInputId,
    textareaPlaceholder,
} from "./ids";

const SOURCE_COMPONENT = "DailyItemField";

export interface DailyItemFieldProps {
    /** `dailyFieldComponent(root, item)`; every id of the item is derived from it. */
    "data-component": string;
    item: DailyItem;
    draft: Record<string, unknown>;
    onFieldChange: (key: string, value: unknown) => void;
    onToggleMulti: (key: string, option: string) => void;
    numericErrors?: ServiceRecordNumericErrors;
    /** The user already pressed the page's next button with this page incomplete. */
    submitted?: boolean;
}

/**
 * One daily item of a day page. It reproduces the shared wizard's `DailyField` for
 * the public (non-admin, editable) flow: `readOnly` is false and every answer is
 * required.
 */
export function DailyItemField({
    "data-component": dataComponent,
    item,
    draft,
    onFieldChange,
    onToggleMulti,
    numericErrors = {},
    submitted = false,
}: DailyItemFieldProps) {
    const value = draft[item.key];
    const slotId = dailyItemSlotId(dataComponent);
    const labelId = dailyItemLabelId(dataComponent);
    const [textFocused, setTextFocused] = useState(false);
    // A "required" message only appears once the field held a value and was cleared (or after submit).
    // Every key is tracked on every render, before any message reads the flags.
    const track = useHadValue();
    const hadMain = track(item.key, value);
    const hadColor = track(`${item.key}_color`, draft[`${item.key}_color`]);
    const hadCounts: Record<string, boolean> = {};
    for (const count of item.counts ?? []) {
        const fieldKey = `${item.key}_${count.k}`;
        hadCounts[fieldKey] = track(fieldKey, draft[fieldKey]);
    }
    const { message, invalidCountKeys, stoolColorMessage } = getDailyItemMessages(item, draft, {
        submitted,
        requireAnswers: true,
        readOnly: false,
        textFocused,
        numericErrors,
        had: { main: hadMain, color: hadColor, counts: hadCounts },
    });
    const hasError = message?.tone === "error";

    const label = (
        <ServiceRecordItemLabel
            data-component={`${dataComponent}_label-row`}
            labelId={labelId}
            label={item.label}
            htmlFor={item.type === "textarea" ? textareaInputId(dataComponent, item.key) : undefined}
            messageId={slotId}
            message={message}
        />
    );

    return (
        <div data-component={dataComponent} data-source-component={SOURCE_COMPONENT} className="min-w-0">
            {label}
            {item.type === "multi" && (
                <OptionButtonGroup
                    data-component={`${dataComponent}_options`}
                    mode="multi"
                    labelledBy={labelId}
                    options={(item.opts ?? []).map((option) => ({ value: option, label: option }))}
                    selected={Array.isArray(value) ? (value as string[]) : []}
                    onToggle={(option) => onToggleMulti(item.key, option)}
                    firstOptionId={firstOptionIdOf(dataComponent)}
                    describedBy={slotId}
                    invalid={hasError}
                />
            )}

            {(item.type === "radio" || item.type === "stool") && (
                <>
                    <OptionButtonGroup
                        data-component={`${dataComponent}_radio-options`}
                        mode="single"
                        labelledBy={labelId}
                        options={(item.opts ?? []).map((option) => ({ value: option, label: option }))}
                        selected={typeof value === "string" ? [value] : []}
                        onToggle={(option) => onFieldChange(item.key, option)}
                        firstOptionId={firstOptionIdOf(dataComponent)}
                        describedBy={slotId}
                        invalid={hasError}
                    />
                    {item.type === "stool" && value === STOOL_ABNORMAL_OPTION && (
                        <div data-component={`${dataComponent}_stool-color`} className="mt-3">
                            <ServiceRecordItemLabel
                                data-component={`${dataComponent}_stool-color-input_label-row`}
                                labelId={`${stoolColorSlotId(dataComponent)}-label`}
                                label={STOOL_COLOR_LABEL}
                                htmlFor={stoolColorInputId(dataComponent)}
                                messageId={stoolColorSlotId(dataComponent)}
                                message={stoolColorMessage}
                            />
                            <Input
                                id={stoolColorInputId(dataComponent)}
                                data-component={`${dataComponent}_stool-color-input`}
                                className="text-base aria-[invalid=true]:border-v3-burgundy"
                                placeholder={STOOL_COLOR_PLACEHOLDER}
                                value={(draft[`${item.key}_color`] as string | undefined) ?? ""}
                                aria-required
                                aria-invalid={stoolColorMessage ? "true" : undefined}
                                aria-describedby={stoolColorSlotId(dataComponent)}
                                onChange={(event) => onFieldChange(`${item.key}_color`, event.target.value)}
                            />
                        </div>
                    )}
                </>
            )}

            {item.type === "counts" && (
                <CountUnitFieldRow data-component={`${dataComponent}_count-options`}>
                    {item.counts?.map((count) => {
                        const fieldKey = `${item.key}_${count.k}`;
                        return (
                            <CountUnitField
                                key={count.k}
                                data-component={`${dataComponent}_count-options_${count.k}-input`}
                                id={countInputId(dataComponent, count.k)}
                                label={count.label}
                                unit={count.unit}
                                ariaLabel={countAccessibleName(item.label, count.label)}
                                value={String(draft[fieldKey] ?? "")}
                                onChange={(next) => onFieldChange(fieldKey, next)}
                                inputMode={count.k === "temp" ? "decimal" : "numeric"}
                                placeholder={countPlaceholder(count)}
                                invalid={invalidCountKeys.has(fieldKey)}
                                describedBy={slotId}
                            />
                        );
                    })}
                </CountUnitFieldRow>
            )}

            {item.type === "textarea" && (
                <Textarea
                    id={textareaInputId(dataComponent, item.key)}
                    data-component={`${dataComponent}_${item.key === "etcService" ? "etc-service" : "notes"}`}
                    className="rounded-[12px] border-[1.5px] bg-white text-base aria-[invalid=true]:border-v3-burgundy"
                    aria-label={item.label}
                    aria-describedby={slotId}
                    aria-invalid={hasError ? "true" : undefined}
                    value={(value as string | undefined) ?? ""}
                    onChange={(event) => onFieldChange(item.key, event.target.value)}
                    onFocus={() => setTextFocused(true)}
                    onBlur={() => setTextFocused(false)}
                    placeholder={textareaPlaceholder(item.key)}
                    maxLength={item.maxLength}
                />
            )}

            {item.type === "confirm" && (
                <OptionButtonGroup
                    data-component={`${dataComponent}_confirm-options`}
                    mode="multi"
                    labelledBy={labelId}
                    options={[{ value: CONFIRM_OPTION_LABEL, label: CONFIRM_OPTION_LABEL }]}
                    selected={value ? [CONFIRM_OPTION_LABEL] : []}
                    onToggle={() => onFieldChange(item.key, !value)}
                    firstOptionId={firstOptionIdOf(dataComponent)}
                    describedBy={slotId}
                    invalid={hasError}
                />
            )}
        </div>
    );
}
