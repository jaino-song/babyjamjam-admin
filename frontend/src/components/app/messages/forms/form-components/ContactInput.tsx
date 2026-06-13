"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";

import { TitleTextInputMolecule } from "./TitleTextInputMolecule";

const PHONE_REGEX = /^[0-9-]*$/;

interface ContactInputProps {
  phone: string;
  setPhone: (phone: string) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
  dataComponent?: string;
  containerClassName?: string;
  inputClassName?: string;
  labelClassName?: string;
}

export const ContactInput = ({
  phone,
  setPhone,
  label,
  placeholder,
  disabled = false,
  dataComponent = "messages-form-contact-input",
  containerClassName,
  inputClassName,
  labelClassName,
}: ContactInputProps) => {
  const [error, setError] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (PHONE_REGEX.test(value)) {
      setPhone(value);
      setError(false);
    } else {
      setError(true);
    }
  };

  return (
    <TitleTextInputMolecule
      dataComponent={dataComponent}
      label={label}
      value={phone}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      helperText={error ? "숫자만 입력할 수 있습니다" : undefined}
      containerClassName={containerClassName}
      inputClassName={inputClassName}
      labelClassName={labelClassName}
    />
  );
};
