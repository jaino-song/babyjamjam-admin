"use client";

import { useState } from "react";
import { useHadValue } from "@babyjamjam/service-record-ui";

export interface ServiceDateEdit {
    text: string;
    base: string;
    day: number;
}

/**
 * The service-date field's state. The shared wizard keeps it at wizard level
 * (SRW:529-532, :536), so it survives review -> back, overview -> day and section
 * edits; the screen root owns it and hands it to the day pages.
 */
export interface ServiceDateFieldState {
    focused: boolean;
    setFocused: (focused: boolean) => void;
    touched: boolean;
    setTouched: (touched: boolean) => void;
    edit: ServiceDateEdit | null;
    setEdit: (edit: ServiceDateEdit | null) => void;
    submittedPageKey: string | null;
    setSubmittedPageKey: (key: string | null) => void;
    /** The field held a value at some render (SRW:589), so a cleared one shows "required". */
    hadValue: boolean;
}

/**
 * Call once per render of the screen root. `currentServiceDate` is the planned/
 * draft date of `day` (`resolvePlannedDates`), exactly what the shared wizard
 * tracks at SRW:586-589 on every render, whatever screen is showing.
 */
export function useServiceDateFieldState({
    currentServiceDate,
    day,
}: {
    currentServiceDate: string;
    day: number;
}): ServiceDateFieldState {
    const [focused, setFocused] = useState(false);
    const [touched, setTouched] = useState(false);
    const [edit, setEdit] = useState<ServiceDateEdit | null>(null);
    const [submittedPageKey, setSubmittedPageKey] = useState<string | null>(null);
    // The package's had-value tracker is SRW's `hadServiceDateValue` ref (SRW:536, :589).
    const trackHadValue = useHadValue();
    const text = edit && edit.base === currentServiceDate && edit.day === day ? edit.text : null;
    const hadValue = trackHadValue("serviceDate", text ?? currentServiceDate);
    return {
        focused, setFocused,
        touched, setTouched,
        edit, setEdit,
        submittedPageKey, setSubmittedPageKey,
        hadValue,
    };
}
