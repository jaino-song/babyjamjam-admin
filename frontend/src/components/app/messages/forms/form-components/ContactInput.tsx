"use client";

import { useEffect, useId, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import { FormHelperText } from "@/components/app/ui/form-section";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { TitleTextInputMolecule } from "./TitleTextInputMolecule";

const PHONE_REGEX = /^[0-9-]*$/;
const PHONE_FORMAT_ERROR_MESSAGE = "숫자만 입력할 수 있습니다";

interface ContactInputProps {
  phone: string;
  setPhone: (phone: string) => void;
  label: string;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  dataComponent?: string;
  containerClassName?: string;
  inputClassName?: string;
  labelClassName?: string;
  /** Optional hint rendered at the right end of the label row. */
  labelTrailing?: ReactNode;
  /** Id of the element inside `labelTrailing`, linked to the input only while that element is shown. */
  labelTrailingId?: string;
  /**
   * Where the format error renders. "below" (default) keeps it under the input;
   * "label-row" shows it in red in the label row, replacing `labelTrailing` while it applies.
   */
  errorPlacement?: "below" | "label-row";
}

export const ContactInput = ({
  phone,
  setPhone,
  label,
  placeholder,
  required = false,
  disabled = false,
  dataComponent = "desktop_messages_form_contact-input",
  containerClassName,
  inputClassName,
  labelClassName,
  labelTrailing,
  labelTrailingId,
  errorPlacement = "below",
}: ContactInputProps) => {
  const [error, setError] = useState(false);
  const errorId = useId();
  const formattedPhone = formatKoreanPhoneNumber(phone);
  const isErrorInLabelRow = errorPlacement === "label-row";

  useEffect(() => {
    if (phone && formattedPhone !== phone) {
      setPhone(formattedPhone);
    }
  }, [formattedPhone, phone, setPhone]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (PHONE_REGEX.test(value)) {
      setPhone(formatKoreanPhoneNumber(value));
      setError(false);
    } else {
      setError(true);
    }
  };

  const showLabelRowError = isErrorInLabelRow && error;

  return (
    <TitleTextInputMolecule
      dataComponent={dataComponent}
      label={label}
      value={formattedPhone}
      onChange={handleChange}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      error={error}
      helperText={error && !isErrorInLabelRow ? PHONE_FORMAT_ERROR_MESSAGE : undefined}
      containerClassName={containerClassName}
      inputClassName={inputClassName}
      labelClassName={labelClassName}
      labelTrailing={
        showLabelRowError ? (
          <FormHelperText
            id={errorId}
            tone="error"
            data-component={`${dataComponent}_error`}
            data-slot="field-error-message"
            className="m-0 text-right"
            aria-live="polite"
          >
            {PHONE_FORMAT_ERROR_MESSAGE}
          </FormHelperText>
        ) : (
          labelTrailing
        )
      }
      aria-invalid={isErrorInLabelRow && error ? true : undefined}
      aria-describedby={showLabelRowError ? errorId : labelTrailing ? labelTrailingId : undefined}
    />
  );
};
