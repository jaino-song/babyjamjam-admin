"use client";

import { useCallback, useState } from "react";
import type { FocusEventHandler } from "react";
import type { FieldInputState } from "@babyjamjam/shared/utils/field-validation-message";

interface FieldFlags {
    hadValue: boolean;
    touched: boolean;
    focused: boolean;
}

const INITIAL_FLAGS: FieldFlags = { hadValue: false, touched: false, focused: false };

/**
 * Per-field interaction flags for the inline field-message contract: a field
 * "had a value" once it held text (so clearing it reports "required"), is
 * "touched" once the user left it with a value, and a form-level `submitted`
 * flag makes every problem field show its message.
 *
 * The current value stays with the caller; `stateOf` merges it with the flags
 * into the `FieldInputState` the shared resolver expects.
 */
export function useFieldInputStates<Key extends string>() {
    const [flags, setFlags] = useState<Partial<Record<Key, FieldFlags>>>({});
    const [submitted, setSubmitted] = useState(false);

    const patch = useCallback((key: Key, update: (current: FieldFlags) => FieldFlags) => {
        setFlags((previous) => ({ ...previous, [key]: update(previous[key] ?? INITIAL_FLAGS) }));
    }, []);

    const onChange = useCallback((key: Key, previousValue: string, nextValue: string) => {
        if (previousValue === "" && nextValue === "") return;
        patch(key, (current) => (current.hadValue ? current : { ...current, hadValue: true }));
    }, [patch]);

    const onFocus = useCallback((key: Key) => {
        patch(key, (current) => (current.focused ? current : { ...current, focused: true }));
    }, [patch]);

    const onBlur = useCallback((key: Key, value: string) => {
        patch(key, (current) => ({ ...current, focused: false, touched: current.touched || value !== "" }));
    }, [patch]);

    const reset = useCallback(() => {
        setFlags({});
        setSubmitted(false);
    }, []);

    const stateOf = (key: Key, value: string): FieldInputState => ({
        value,
        ...(flags[key] ?? INITIAL_FLAGS),
    });

    const focusProps = (key: Key, value: string): {
        onFocus: FocusEventHandler<HTMLInputElement>;
        onBlur: FocusEventHandler<HTMLInputElement>;
    } => ({
        onFocus: () => onFocus(key),
        onBlur: () => onBlur(key, value),
    });

    return { submitted, setSubmitted, stateOf, onChange, onFocus, onBlur, focusProps, reset };
}
