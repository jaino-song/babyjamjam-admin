"use client";

import { focusFirstProblem, getPhoneState, type ServiceRecordWizardProps } from "@babyjamjam/service-record-ui";

import { Input } from "@/components/app/v3/Input";
import { ServiceRecordItemLabel } from "@/components/app/v3/ServiceRecordItemLabel";
import { StickyActionBar } from "@/components/app/v3/StickyActionBar";
import { Button } from "@/components/ui/button";

import {
    PHONE_HELP_COPY,
    PHONE_HELPER_ID,
    PHONE_INPUT_ID,
    PHONE_LABEL,
    PHONE_LABEL_ID,
    PHONE_PLACEHOLDER,
    PHONE_SUBMIT_BUSY_LABEL,
    PHONE_SUBMIT_LABEL,
    PHONE_TITLE,
} from "./ids";
import type { PhoneFieldState } from "./fieldInteractionState";

const SOURCE_COMPONENT = "PhoneStep";

export type PhoneStepProps = Pick<
    ServiceRecordWizardProps,
    "data-component" | "phone" | "phoneError" | "phoneFieldError" | "busy" | "onPhoneChange" | "onSubmitPhone"
> & {
    /** The phone field's interaction state, owned by the screen root so it outlives this step (SRW:526-528, :535). */
    fieldState: PhoneFieldState;
};

/** The identity check (SRW:716-747). */
export function PhoneStep({
    "data-component": root,
    phone,
    phoneError,
    phoneFieldError,
    busy,
    onPhoneChange,
    onSubmitPhone,
    fieldState,
}: PhoneStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const {
        focused: phoneFocused,
        setFocused: setPhoneFocused,
        touched: phoneTouched,
        setTouched: setPhoneTouched,
        submitted: phoneSubmitted,
        setSubmitted: setPhoneSubmitted,
        hadValue: hadPhoneValue,
    } = fieldState;
    const { complete: phoneComplete, message: phoneMessage } = getPhoneState(phone, {
        hadValue: hadPhoneValue,
        touched: phoneTouched,
        focused: phoneFocused,
        submitted: phoneSubmitted,
        phoneFieldError,
    });

    const handleSubmitPhone = () => {
        setPhoneSubmitted(true);
        if (!phoneComplete) {
            focusFirstProblem(PHONE_INPUT_ID);
            return;
        }
        void onSubmitPhone();
    };

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-3.5 px-4 pb-6 pt-4"
            >
                <div data-component={child("body_phone-title")} className="text-lg font-bold text-v3-dark">
                    {PHONE_TITLE}
                </div>
                <p data-component={child("body_phone-help")} className="text-sm text-v3-text-muted">{PHONE_HELP_COPY}</p>
                {phoneError ? (
                    <p
                        data-component={child("body_phone-error")}
                        role="alert"
                        className="rounded-[10px] bg-v3-burgundy-light px-3 py-2 text-[13px] font-semibold text-v3-burgundy"
                    >
                        {phoneError}
                    </p>
                ) : null}
                <div data-component={child("body_phone-field")} className="min-w-0">
                    <ServiceRecordItemLabel
                        data-component={child("body_phone-input_label-row")}
                        labelId={PHONE_LABEL_ID}
                        label={PHONE_LABEL}
                        htmlFor={PHONE_INPUT_ID}
                        messageId={PHONE_HELPER_ID}
                        message={phoneMessage}
                    />
                    <Input
                        id={PHONE_INPUT_ID}
                        data-component={child("body_phone-input")}
                        className="text-base focus-visible:border-v3-primary! aria-[invalid=true]:border-v3-burgundy!"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={13}
                        placeholder={PHONE_PLACEHOLDER}
                        aria-describedby={PHONE_HELPER_ID}
                        aria-invalid={phoneMessage?.tone === "error" ? "true" : undefined}
                        value={phone}
                        onFocus={() => setPhoneFocused(true)}
                        onBlur={() => {
                            setPhoneFocused(false);
                            if (phone !== "") setPhoneTouched(true);
                        }}
                        onChange={(event) => onPhoneChange(event.target.value)}
                    />
                </div>
            </div>
            <StickyActionBar data-component={child("body_phone-actions")}>
                <Button
                    type="button"
                    variant="v3"
                    size="md"
                    data-component={child("body_phone-submit")}
                    disabled={busy}
                    onClick={handleSubmitPhone}
                >
                    {busy ? PHONE_SUBMIT_BUSY_LABEL : PHONE_SUBMIT_LABEL}
                </Button>
            </StickyActionBar>
        </>
    );
}
