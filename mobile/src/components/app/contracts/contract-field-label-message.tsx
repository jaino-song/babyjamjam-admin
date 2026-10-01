import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import styles from "./contract-field-label-message.module.css";

// 라벨 줄 오른쪽에 한 번에 하나만 보여주는 필드 메시지예요. 검증 오류(빨강)가 있으면 등록값 다름 힌트(초록)보다 먼저 보여줘요.
export interface FieldLabelMessage {
  slot: "field-error-message" | "registered-value-diff-hint";
  id: string;
  text: ReactNode;
  testId?: string;
}

interface ContractFieldLabelMessageProps {
  dataComponent: string;
  message: FieldLabelMessage;
}

export function ContractFieldLabelMessage({ dataComponent, message }: ContractFieldLabelMessageProps) {
  const isError = message.slot === "field-error-message";
  return (
    <span
      id={message.id}
      className={cn(styles.message, isError ? styles.helper_err : styles.helper_ok)}
      data-component={`${dataComponent}_${message.slot}`}
      data-slot={message.slot}
      data-testid={message.testId}
      aria-live={isError ? "polite" : undefined}
    >
      {message.text}
    </span>
  );
}
