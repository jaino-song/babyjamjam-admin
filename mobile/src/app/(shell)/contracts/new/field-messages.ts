import { useCallback, useState } from "react";
import {
  isRealIsoDate,
  resolveFieldMessage,
  withObjectParticle,
  type FieldInputState,
  type FieldMessage,
} from "@babyjamjam/shared/utils/field-validation-message";

// 계약서 생성 화면의 필드 메시지 문구와 입력 상호작용 상태예요. 판단은 shared의 resolveFieldMessage가 하고,
// 여기서는 그 코드에 이 화면의 짧은 문구를 붙여요. 문구는 라벨 줄 한 줄(360px)에 들어가야 해요.

export const PHONE_FORMAT_HINT = "010-1234-5678 형식";
export const PHONE_FORMAT_ERROR = "010-1234-5678로 입력해 주세요";
export const DATE_FORMAT_HINT = "YYYY-MM-DD 형식";
export const DATE_FORMAT_ERROR = "YYYY-MM-DD로 입력해 주세요";
export const DATE_INVALID_ERROR = "존재하지 않는 날짜예요";
export const DATE_RANGE_ERROR = "종료일은 시작일 이후여야 해요";
export const BIRTHDAY_FUTURE_ERROR = "미래 날짜는 입력할 수 없어요";
export const END_DATE_AUTO_CALC_INFO = "주말·공휴일 제외, 자동 계산";

export const PHONE_PLACEHOLDER = "010-1234-5678";
export const BIRTHDAY_PLACEHOLDER = "1958-03-03";
export const START_DATE_PLACEHOLDER = "2026-12-01";
export const END_DATE_PLACEHOLDER = "2026-12-19";
export const PAYMENT_DATE_PLACEHOLDER = "2026-12-01";

export type ContractFieldKey = "phone" | "birthday" | "startDate" | "endDate" | "paymentDate";

// 필드 이름(필수 오류 문구에 쓰여요). 라벨이 길면 문구에 맞는 짧은 이름을 써요.
const FIELD_NOUN: Record<ContractFieldKey, string> = {
  phone: "연락처",
  birthday: "생년월일",
  startDate: "시작일",
  endDate: "종료일",
  paymentDate: "수령 날짜",
};

export function getFieldMessageText(key: ContractFieldKey, message: FieldMessage): string {
  switch (message.code) {
    case "required":
      return `${withObjectParticle(FIELD_NOUN[key])} 입력해 주세요`;
    case "phone-format-hint":
      return PHONE_FORMAT_HINT;
    case "phone-format":
      return PHONE_FORMAT_ERROR;
    case "date-format-hint":
      return DATE_FORMAT_HINT;
    case "date-format":
      return DATE_FORMAT_ERROR;
    case "date-invalid":
      return DATE_INVALID_ERROR;
    case "date-range":
      return DATE_RANGE_ERROR;
  }
}

// ── 계약 날짜 검증 ─────────────────────────────────────────────
// 입력칸에는 YYYY-MM-DD가 그대로 들어 있어요. 저장·전송 값도 같은 ISO 문자열이라 변환이 없어요.

export type ContractDateField = "startDate" | "endDate" | "paymentDate";

export interface ContractDateInputs {
  startDateInput: string;
  endDateInput: string;
  paymentDateInput: string;
}

export interface ContractDateValues {
  startDate: string;
  endDate: string;
  paymentDate: string;
}

export interface ContractDateProblem {
  field: ContractDateField;
  message: FieldMessage;
}

export function getContractDateValues(inputs: ContractDateInputs): ContractDateValues {
  const real = (value: string): string => (isRealIsoDate(value) ? value : "");
  return {
    startDate: real(inputs.startDateInput),
    endDate: real(inputs.endDateInput),
    paymentDate: real(inputs.paymentDateInput),
  };
}

// 화면에 보이는 상태와 상관없이 "지금 값이 틀렸는가"만 봐요. 제출 가능 여부와 첫 문제 필드 찾기에 써요.
function settledError(
  kind: "phone" | "date",
  value: string,
  opts: { required?: boolean; dateRange?: { notBefore?: string } } = {},
): FieldMessage | null {
  const message = resolveFieldMessage(
    kind,
    { value, hadValue: true, touched: true, focused: false },
    { ...opts, submitted: true },
  );
  return message?.tone === "error" ? message : null;
}

export function getPhoneProblem(phone: string): FieldMessage | null {
  return settledError("phone", phone, { required: true });
}

export function getContractDateProblem(inputs: ContractDateInputs): ContractDateProblem | null {
  const startError = settledError("date", inputs.startDateInput, { required: true });
  if (startError) return { field: "startDate", message: startError };

  const endError = settledError("date", inputs.endDateInput, {
    required: true,
    dateRange: { notBefore: inputs.startDateInput },
  });
  if (endError) return { field: "endDate", message: endError };

  const paymentError = settledError("date", inputs.paymentDateInput, { required: true });
  if (paymentError) return { field: "paymentDate", message: paymentError };

  return null;
}

// 생년월일은 선택 입력이에요. 형식·실존 여부는 resolver가, "오늘 이후 날짜 불가"는 호출자(isValidBirthday)가 판단해요.
const BIRTHDAY_FUTURE_MESSAGE: FieldMessage = { tone: "error", code: "date-invalid", params: { reason: "future" } };

export function resolveBirthdayMessage(
  state: FieldInputState,
  submitted: boolean,
  isValidBirthday: (value: string) => boolean,
): FieldMessage | null {
  const message = resolveFieldMessage("date", state, { submitted });
  if (message) return message;
  return state.value !== "" && !isValidBirthday(state.value) ? BIRTHDAY_FUTURE_MESSAGE : null;
}

export function getBirthdayProblem(
  birthday: string,
  isValidBirthday: (value: string) => boolean,
): FieldMessage | null {
  const message = resolveBirthdayMessage(
    { value: birthday, hadValue: true, touched: true, focused: false },
    true,
    isValidBirthday,
  );
  return message?.tone === "error" ? message : null;
}

export function getBirthdayMessageText(message: FieldMessage): string {
  return message.params?.reason === "future" ? BIRTHDAY_FUTURE_ERROR : getFieldMessageText("birthday", message);
}

// ── 입력 상호작용 상태 ─────────────────────────────────────────
// 값은 화면이 들고 있고, 여기서는 "값을 가진 적 있는지 / 떠났는지 / 지금 포커스인지"만 기억해요.

type FieldInteraction = Pick<FieldInputState, "hadValue" | "touched" | "focused">;

const INITIAL_INTERACTION: FieldInteraction = { hadValue: false, touched: false, focused: false };

export function useFieldInteractions() {
  const [interactions, setInteractions] = useState<Partial<Record<ContractFieldKey, FieldInteraction>>>({});

  const update = useCallback((key: ContractFieldKey, patch: (current: FieldInteraction) => FieldInteraction) => {
    setInteractions((current) => ({ ...current, [key]: patch(current[key] ?? INITIAL_INTERACTION) }));
  }, []);

  const getState = (key: ContractFieldKey, value: string): FieldInputState => {
    const interaction = interactions[key] ?? INITIAL_INTERACTION;
    return { value, ...interaction, hadValue: interaction.hadValue || value !== "" };
  };

  // 지운 값도 "값을 가진 적 있음"이라, 이전 값이 있었으면 지웠을 때 필수 메시지가 떠요.
  const onChange = (key: ContractFieldKey, previousValue: string, nextValue: string) => {
    update(key, (current) => ({
      ...current,
      hadValue: current.hadValue || previousValue !== "" || nextValue !== "",
    }));
  };
  const onFocus = (key: ContractFieldKey) => {
    update(key, (current) => ({ ...current, focused: true }));
  };
  const onBlur = (key: ContractFieldKey, value: string) => {
    update(key, (current) => ({ ...current, focused: false, touched: current.touched || value !== "" }));
  };

  return { getState, onChange, onFocus, onBlur };
}

// ── 첫 문제 필드로 이동 ────────────────────────────────────────

export function focusContractField(selector: string): boolean {
  if (typeof document === "undefined") return false;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return false;
  element.scrollIntoView?.({ block: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
  return true;
}
