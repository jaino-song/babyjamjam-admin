"use client";

import { useState } from "react";
import { useHadValue, type ServiceRecordHeaderValidationKey } from "@babyjamjam/service-record-ui";
import { SERVICE_RECORD_HEADER_KEYS } from "@babyjamjam/shared/utils/service-record-input";

/**
 * The phone and header fields' interaction state. The shared wizard keeps it at
 * wizard level (SRW:523-528, :534-535, :543-545, :557), tracked on every render
 * whatever screen is showing, so it survives leaving the step and coming back
 * through the browser history. The screen root owns it and hands it to the steps.
 */
export interface PhoneFieldState {
    focused: boolean;
    setFocused: (focused: boolean) => void;
    touched: boolean;
    setTouched: (touched: boolean) => void;
    submitted: boolean;
    setSubmitted: (submitted: boolean) => void;
    /** The field held a value at some render (SRW:535, :557). */
    hadValue: boolean;
}

export function usePhoneFieldState(phone: string): PhoneFieldState {
    const [focused, setFocused] = useState(false);
    const [touched, setTouched] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const trackHadValue = useHadValue();
    const hadValue = trackHadValue("phone", phone);
    return { focused, setFocused, touched, setTouched, submitted, setSubmitted, hadValue };
}

export interface HeaderFieldState {
    touched: Partial<Record<ServiceRecordHeaderValidationKey, boolean>>;
    touch: (key: ServiceRecordHeaderValidationKey) => void;
    focused: ServiceRecordHeaderValidationKey | null;
    setFocused: (key: ServiceRecordHeaderValidationKey | null) => void;
    submitted: boolean;
    setSubmitted: (submitted: boolean) => void;
    /** Per key: the field held a value at some render (SRW:534, :543-545). */
    hadValue: Partial<Record<ServiceRecordHeaderValidationKey, boolean>>;
}

export function useHeaderFieldState(header: Record<string, string>): HeaderFieldState {
    const [touched, setTouched] = useState<Partial<Record<ServiceRecordHeaderValidationKey, boolean>>>({});
    const [focused, setFocused] = useState<ServiceRecordHeaderValidationKey | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const trackHadValue = useHadValue();
    // Every key is tracked on every render, before any message reads the flags.
    const hadValue: Partial<Record<ServiceRecordHeaderValidationKey, boolean>> = {};
    for (const key of SERVICE_RECORD_HEADER_KEYS) hadValue[key] = trackHadValue(key, header[key]);
    return {
        touched,
        touch: (key) => setTouched((current) => ({ ...current, [key]: true })),
        focused, setFocused,
        submitted, setSubmitted,
        hadValue,
    };
}
