import { yymmddToIso } from "./date-input";

export type ContractDateField = "startDate" | "endDate" | "paymentDate";

export interface ContractDateInputs {
  startDateInput: string;
  endDateInput: string;
  paymentDateInput: string;
}

export interface ContractDateValidation {
  field: ContractDateField;
  message: string;
}

export interface ContractDateValues {
  startDate: string;
  endDate: string;
  paymentDate: string;
}

const CONTRACT_START_DATE_REQUIRED_MESSAGE = "계약 시작일을 입력해 주세요.";
const CONTRACT_START_DATE_INVALID_MESSAGE =
  "계약 시작일은 6자리(YYMMDD) 형식의 유효한 날짜를 입력해 주세요.";
const CONTRACT_END_DATE_REQUIRED_MESSAGE = "계약 종료일을 입력해 주세요.";
const CONTRACT_END_DATE_INVALID_MESSAGE =
  "종료일은 6자리(YYMMDD) 형식의 유효한 날짜를 입력해 주세요.";
const CONTRACT_DATE_RANGE_ERROR_MESSAGE = "종료일은 시작일과 같거나 이후로 입력해 주세요.";
const CONTRACT_PAYMENT_DATE_REQUIRED_MESSAGE = "본인부담금 수령 날짜를 입력해 주세요.";
const CONTRACT_PAYMENT_DATE_INVALID_MESSAGE =
  "본인부담금 수령 날짜는 6자리(YYMMDD) 형식의 유효한 날짜를 입력해 주세요.";

const DATE_FIELD_RULES: Record<ContractDateField, {
  requiredMessage: string;
  invalidMessage: string;
}> = {
  startDate: {
    requiredMessage: CONTRACT_START_DATE_REQUIRED_MESSAGE,
    invalidMessage: CONTRACT_START_DATE_INVALID_MESSAGE,
  },
  endDate: {
    requiredMessage: CONTRACT_END_DATE_REQUIRED_MESSAGE,
    invalidMessage: CONTRACT_END_DATE_INVALID_MESSAGE,
  },
  paymentDate: {
    requiredMessage: CONTRACT_PAYMENT_DATE_REQUIRED_MESSAGE,
    invalidMessage: CONTRACT_PAYMENT_DATE_INVALID_MESSAGE,
  },
};

function validateDateInput(value: string, field: ContractDateField): string | null {
  const rules = DATE_FIELD_RULES[field];
  if (!value) return rules.requiredMessage;
  if (!/^\d{6}$/.test(value) || !yymmddToIso(value)) return rules.invalidMessage;
  return null;
}

export function getContractDateValues(inputs: ContractDateInputs): ContractDateValues {
  return {
    startDate: yymmddToIso(inputs.startDateInput),
    endDate: yymmddToIso(inputs.endDateInput),
    paymentDate: yymmddToIso(inputs.paymentDateInput),
  };
}

export function getContractDateValidation(inputs: ContractDateInputs): ContractDateValidation | null {
  const startError = validateDateInput(inputs.startDateInput, "startDate");
  if (startError) return { field: "startDate", message: startError };

  const endError = validateDateInput(inputs.endDateInput, "endDate");
  if (endError) return { field: "endDate", message: endError };

  const values = getContractDateValues(inputs);
  if (values.endDate < values.startDate) {
    return { field: "endDate", message: CONTRACT_DATE_RANGE_ERROR_MESSAGE };
  }

  const paymentError = validateDateInput(inputs.paymentDateInput, "paymentDate");
  if (paymentError) return { field: "paymentDate", message: paymentError };

  return null;
}
