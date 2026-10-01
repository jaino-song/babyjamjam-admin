"use client";

import { useCallback, useState } from "react";
import type { FieldInputState } from "@babyjamjam/shared/utils/field-validation-message";

import type { Locale } from "@/lib/i18n/translations";
import {
  isFieldValueInvalid,
  resolveSlotMessage,
  type FieldSpec,
  type SlotMessage,
} from "@/lib/validations/field-message";

interface FieldFlags {
  touched: boolean;
  focused: boolean;
}

const INITIAL_FLAGS: FieldFlags = { touched: false, focused: false };

interface UseFieldMessagesOptions<K extends string> {
  /** Current value of every tracked field (the form owns the values). */
  values: Readonly<Record<K, string>>;
  specs: Readonly<Partial<Record<K, FieldSpec>>>;
  locale: Locale;
}

/**
 * Tracks what the shared field-message resolver needs besides the value
 * (hadValue / touched / focused / form-level submitted) and resolves the one
 * message each field's label-row slot shows. The form keeps owning the values.
 */
export function useFieldMessages<K extends string>({
  values,
  specs,
  locale,
}: UseFieldMessagesOptions<K>) {
  const [flags, setFlags] = useState<Partial<Record<K, FieldFlags>>>({});
  const [hadValue, setHadValue] = useState<Partial<Record<K, true>>>({});
  const [submitted, setSubmitted] = useState(false);

  // Whitespace alone is not a value for a text field.
  const valueOf = (field: K): string => {
    const value = values[field];
    return specs[field]?.kind === "text" && value.trim() === "" ? "" : value;
  };

  // A field "had a value" once it held one, however it got there (typing or a
  // prefill), so clearing it later is reported as a missing required value.
  const newlyFilled = (Object.keys(values) as K[]).filter(
    (field) => valueOf(field) !== "" && !hadValue[field],
  );
  if (newlyFilled.length > 0) {
    setHadValue((previous) => {
      const next = { ...previous };
      newlyFilled.forEach((field) => {
        next[field] = true;
      });
      return next;
    });
  }

  const stateOf = (field: K): FieldInputState => ({
    value: valueOf(field),
    hadValue: hadValue[field] === true,
    touched: flags[field]?.touched ?? false,
    focused: flags[field]?.focused ?? false,
  });

  const slot = (field: K): SlotMessage | null => {
    const spec = specs[field];
    return spec ? resolveSlotMessage(locale, spec, stateOf(field), { submitted }) : null;
  };

  const isInvalid = (field: K): boolean => {
    const spec = specs[field];
    return spec ? isFieldValueInvalid(locale, spec, valueOf(field)) : false;
  };

  const invalidFields = (order: ReadonlyArray<K>): K[] => order.filter(isInvalid);

  const bind = (field: K) => ({
    onFocus: () =>
      setFlags((previous) => ({
        ...previous,
        [field]: { ...(previous[field] ?? INITIAL_FLAGS), focused: true },
      })),
    onBlur: () =>
      setFlags((previous) => {
        const current = previous[field] ?? INITIAL_FLAGS;
        return {
          ...previous,
          [field]: { touched: current.touched || valueOf(field) !== "", focused: false },
        };
      }),
  });

  const markSubmitted = useCallback(() => setSubmitted(true), []);

  const reset = useCallback(() => {
    setFlags({});
    setHadValue({});
    setSubmitted(false);
  }, []);

  return { slot, isInvalid, invalidFields, bind, markSubmitted, reset, submitted };
}
