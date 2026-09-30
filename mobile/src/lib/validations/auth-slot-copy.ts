import type { SlotMessage } from "@/lib/validations/field-message";

/**
 * The account forms still get some messages from the shared zod schemas and the
 * server. Those sentences are written for a full-width alert; a field's label-row
 * slot fits one short line, so they are replaced by short copy here. Anything not
 * listed keeps its own text (minus the final period) and is ellipsised by the slot.
 */
const SHORT_COPY: Readonly<Record<string, string>> = {
  "이름에는 숫자나 특수문자를 입력할 수 없어요.": "숫자·특수문자는 쓸 수 없어요",
  "확인할 비밀번호를 다시 입력해 주세요.": "비밀번호를 다시 입력해 주세요",
  "전화번호 형식이 올바르지 않아요. 010-1234-5678처럼 입력해 주세요.": "010-1234-5678 형식으로 입력해 주세요",
  "생년월일 형식이 올바르지 않아요. 1990-01-01처럼 입력해 주세요.": "YYYY-MM-DD로 입력해 주세요",
  "올바른 생년월일을 오늘보다 이전 날짜로 입력해 주세요.": "미래 날짜는 입력할 수 없어요",
};

const PASSWORD_RULE_COPY = "비밀번호 조건을 확인해 주세요";

export function toAuthSlotCopy(field: string, message: string): string {
  if (field === "password") return PASSWORD_RULE_COPY;
  return SHORT_COPY[message] ?? message.replace(/\.$/, "");
}

export function authErrorSlot(field: string, message: string | undefined): SlotMessage | null {
  return message ? { text: toAuthSlotCopy(field, message), tone: "err" } : null;
}
