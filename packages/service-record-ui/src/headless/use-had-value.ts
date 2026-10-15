"use client";

import { useRef } from "react";
import { hasDisplayValue } from "../form-definition";

/** `false` is an answer to the payment confirmation, but it is not a filled value. */
const isFilled = (value: unknown): boolean => value !== false && hasDisplayValue(value);

/**
 * Remembers, per key, whether the field ever held a value. A "required" message only
 * appears once a field held a value and was cleared (or after submit). Call `track`
 * every render for every key, before reading any message that depends on it.
 */
export function useHadValue(): (key: string, value: unknown) => boolean {
    const had = useRef<Record<string, boolean>>({});
    return (key, value) => {
        if (isFilled(value)) had.current[key] = true;
        return Boolean(had.current[key]);
    };
}
