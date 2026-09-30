"use client";

import { useEffect, useId, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { resolveFieldMessage } from "@babyjamjam/shared/utils/field-validation-message";

import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import { toFieldMessageView, type FieldMessageView } from "@/lib/forms/field-message-text";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { useLocale } from "@/providers/LocaleProvider";
import { TitleTextInputMolecule } from "./TitleTextInputMolecule";

const PHONE_REGEX = /^[0-9-]*$/;
const PHONE_FORMAT_ERROR_MESSAGE = "숫자만 입력할 수 있습니다";

export interface ContactInputMessage {
  tone: "hint" | "error";
  text: string;
}

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
  /**
   * Informational hint for the right end of the label row. It shows only while
   * the field has no error or format hint of its own.
   */
  labelTrailing?: ReactNode;
  /** Id of the element inside `labelTrailing`, linked to the input only while that element is shown. */
  labelTrailingId?: string;
  /** @deprecated Every message renders in the label row; kept so existing callers still type-check. */
  errorPlacement?: "below" | "label-row";
  /**
   * Form-level flag: the user already tried to submit, so a required field that
   * is still empty (or incomplete) shows its message.
   */
  submitted?: boolean;
  /**
   * A message the parent wants in the same slot. It competes with the field's
   * own messages by priority: error, then hint, then `labelTrailing`.
   */
  externalMessage?: ContactInputMessage | null;
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
  submitted = false,
  externalMessage = null,
}: ContactInputProps) => {
  const locale = useLocale();
  const [hasRejectedInput, setHasRejectedInput] = useState(false);
  const fields = useFieldInputStates<"phone">();
  const messageId = useId();
  const formattedPhone = formatKoreanPhoneNumber(phone);

  useEffect(() => {
    if (phone && formattedPhone !== phone) {
      setPhone(formattedPhone);
    }
  }, [formattedPhone, phone, setPhone]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (PHONE_REGEX.test(value)) {
      const nextPhone = formatKoreanPhoneNumber(value);
      fields.onChange("phone", formattedPhone, nextPhone);
      setPhone(nextPhone);
      setHasRejectedInput(false);
    } else {
      setHasRejectedInput(true);
    }
  };

  const fieldMessage = toFieldMessageView(
    locale,
    resolveFieldMessage("phone", fields.stateOf("phone", formattedPhone), { required, submitted }),
    label,
  );
  const candidates: Array<FieldMessageView | null> = [
    hasRejectedInput ? { tone: "error", text: PHONE_FORMAT_ERROR_MESSAGE } : null,
    fieldMessage?.tone === "error" ? fieldMessage : null,
    externalMessage?.tone === "error" ? externalMessage : null,
    fieldMessage?.tone === "hint" ? fieldMessage : null,
    externalMessage?.tone === "hint" ? externalMessage : null,
  ];
  const message = disabled ? null : candidates.find((candidate) => candidate !== null) ?? null;
  const hasError = message?.tone === "error";

  return (
    <TitleTextInputMolecule
      dataComponent={dataComponent}
      label={label}
      value={formattedPhone}
      onChange={handleChange}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      error={hasError}
      containerClassName={containerClassName}
      inputClassName={inputClassName}
      labelClassName={labelClassName}
      labelRowClassName={FIELD_MESSAGE_LABEL_ROW_CLASS_NAME}
      labelTrailingClassName={FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME}
      labelTrailing={
        message ? (
          <FieldMessageText id={messageId} tone={message.tone} data-component={`${dataComponent}_helper`}>
            {message.text}
          </FieldMessageText>
        ) : (
          labelTrailing
        )
      }
      aria-invalid={hasError ? true : undefined}
      aria-describedby={message ? messageId : labelTrailing ? labelTrailingId : undefined}
      {...fields.focusProps("phone", formattedPhone)}
    />
  );
};
