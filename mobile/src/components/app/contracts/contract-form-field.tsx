import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import styles from "./contract-form-field.module.css";

// 필드 하나가 라벨 줄 오른쪽에 보여주는 메시지예요. 오류 > 힌트 > 안내 순서로 하나만 골라서 넘겨요.
export type ContractFormFieldMessageSlot =
  | "field-error-message"
  | "field-hint-message"
  | "field-info-message"
  | "registered-value-diff-hint";

export interface ContractFormFieldMessage {
  slot: ContractFormFieldMessageSlot;
  id: string;
  text: ReactNode;
  testId?: string;
}

interface ContractFormFieldProps {
  dataComponent: string;
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  message?: ContractFormFieldMessage | null;
}

const TONE_CLASS: Record<ContractFormFieldMessageSlot, string | undefined> = {
  "field-error-message": styles.tone_error,
  "field-hint-message": undefined,
  "field-info-message": undefined,
  "registered-value-diff-hint": styles.tone_ok,
};

export function ContractFormField({
  dataComponent,
  label,
  htmlFor,
  required,
  children,
  message,
}: ContractFormFieldProps) {
  return (
    <div className={styles.formRow} data-component={dataComponent}>
      <div className={styles.labelRow} data-component={`${dataComponent}_label-row`}>
        <label className={styles.label} htmlFor={htmlFor} data-component={`${dataComponent}_label`}>
          {label}
          {required ? (
            <span className={styles.requiredMark} data-component={`${dataComponent}_required`}>*</span>
          ) : null}
        </label>
        {message ? (
          <span
            id={message.id}
            className={cn(styles.message, TONE_CLASS[message.slot])}
            data-component={`${dataComponent}_${message.slot}`}
            data-slot={message.slot}
            data-testid={message.testId}
            aria-live="polite"
          >
            {message.text}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
