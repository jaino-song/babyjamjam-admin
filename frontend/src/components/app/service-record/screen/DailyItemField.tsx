"use client";

import { useState } from "react";
import {
    getDailyItemMessages,
    useHadValue,
    type DailyItem,
    type ServiceRecordNumericErrors,
} from "@babyjamjam/service-record-ui";

import {
    CountUnitField,
    CountUnitFieldRow,
    OptionButtonGroup,
    ServiceRecordItemLabel,
} from "@/components/app/ui/service-record";
import { Input } from "@/components/ui/input";
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

/**
 * SRW:1011 - `requireAnswers={!adminMode && !readOnly}`; the admin editor always has
 * `adminMode`, so no answer is required: no "required" message, `aria-required` false.
 */
const REQUIRE_ANSWERS = false;

export interface DailyItemFieldProps {
    /** `dailyFieldComponent(root, item)`; every id of the item is derived from it. */
    "data-component": string;
    item: DailyItem;
    draft: Record<string, unknown>;
    onFieldChange: (key: string, value: unknown) => void;
    onToggleMulti: (key: string, option: string) => void;
    numericErrors?: ServiceRecordNumericErrors;
    /**
     * Presentation-only mode (SRW:189): every control is disabled and the textarea
     * shows no counter. The admin editor passes its `locked` flag.
     */
    readOnly?: boolean;
}

/**
 * One daily item of an admin day page. It reproduces the shared wizard's `DailyField`
 * as the admin editor drives it (`adminMode`, `readOnly` passed through).
 */
export function DailyItemField({
    "data-component": dataComponent,
    item,
    draft,
    onFieldChange,
    onToggleMulti,
    numericErrors = {},
    readOnly = false,
}: DailyItemFieldProps) {
    const value = draft[item.key];
    const slotId = dailyItemSlotId(dataComponent);
    const labelId = dailyItemLabelId(dataComponent);
    const [textFocused, setTextFocused] = useState(false);
    // Tracked exactly as SRW:211-218 does: every key on every render, before any message reads the flags.
    const track = useHadValue();
    const hadMain = track(item.key, value);
    const hadColor = track(`${item.key}_color`, draft[`${item.key}_color`]);
    const hadCounts: Record<string, boolean> = {};
    for (const count of item.counts ?? []) {
        const fieldKey = `${item.key}_${count.k}`;
        hadCounts[fieldKey] = track(fieldKey, draft[fieldKey]);
    }
    const { message, invalidCountKeys, stoolColorMessage } = getDailyItemMessages(item, draft, {
        // SRW:1010 - `daySubmitted` only becomes true through the public next-button validation (SRW:667-670), which admin skips (SRW:663-666).
        submitted: false,
        requireAnswers: REQUIRE_ANSWERS,
        readOnly, // SRW:223
        textFocused,
        numericErrors,
        had: { main: hadMain, color: hadColor, counts: hadCounts },
    });
    const hasError = message?.tone === "error";

    return (
        <div data-component={dataComponent} data-source-component={SOURCE_COMPONENT} className="min-w-0">
            <ServiceRecordItemLabel
                data-component={`${dataComponent}_label-row`}
                labelId={labelId}
                label={item.label}
                htmlFor={item.type === "textarea" ? textareaInputId(dataComponent, item.key) : undefined}
                messageId={slotId}
                message={message}
            />
            {item.type === "multi" && (
                <OptionButtonGroup
                    data-component={`${dataComponent}_options`}
                    mode="multi"
                    labelledBy={labelId}
                    options={(item.opts ?? []).map((option) => ({ value: option, label: option }))}
                    selected={Array.isArray(value) ? (value as string[]) : []}
                    onToggle={(option) => onToggleMulti(item.key, option)}
                    disabled={readOnly} // SRW:249
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
                        disabled={readOnly} // SRW:269
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
                                variant="v3"
                                className="aria-[invalid=true]:border-v3-burgundy!"
                                placeholder={STOOL_COLOR_PLACEHOLDER}
                                value={(draft[`${item.key}_color`] as string | undefined) ?? ""}
                                disabled={readOnly} // SRW:294
                                aria-required={REQUIRE_ANSWERS} // SRW:295
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
                                type="number"
                                min={count.min ?? 0}
                                step={count.step ?? 1}
                                inputMode={count.k === "temp" ? "decimal" : "numeric"}
                                placeholder={countPlaceholder(count)}
                                invalid={invalidCountKeys.has(fieldKey)}
                                describedBy={slotId}
                                disabled={readOnly} // SRW:332
                            />
                        );
                    })}
                </CountUnitFieldRow>
            )}

            {item.type === "textarea" && (
                <Textarea
                    id={textareaInputId(dataComponent, item.key)}
                    data-component={`${dataComponent}_${item.key === "etcService" ? "etc-service" : "notes"}`}
                    className="aria-[invalid=true]:border-v3-burgundy!"
                    aria-label={item.label}
                    aria-describedby={slotId}
                    aria-invalid={hasError ? "true" : undefined}
                    value={(value as string | undefined) ?? ""}
                    onChange={(event) => onFieldChange(item.key, event.target.value)}
                    onFocus={() => setTextFocused(true)}
                    onBlur={() => setTextFocused(false)}
                    placeholder={textareaPlaceholder(item.key)}
                    maxLength={item.maxLength} // SRW:365
                    disabled={readOnly} // SRW:366
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
                    disabled={readOnly} // SRW:381
                    firstOptionId={firstOptionIdOf(dataComponent)}
                    describedBy={slotId}
                    invalid={hasError}
                />
            )}
        </div>
    );
}
