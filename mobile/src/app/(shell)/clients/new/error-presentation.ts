import { resolveProblemPresentation } from "@babyjamjam/shared";
import type { ProblemError } from "@babyjamjam/shared/errors/problem-details";

import { t, type Locale } from "@/lib/i18n/translations";

export const CLIENT_WIZARD_ERROR_SUMMARY_ID = "mobile_clients-new_screen_root_error-summary";

export const CLIENT_WIZARD_FIELD_IDS = [
  "name",
  "phone",
  "birthday",
  "dueDate",
  "birthDate",
  "address",
  "primaryEmployeeId",
  "secondaryEmployeeId",
  "type",
  "duration",
  "fullPrice",
  "grant",
  "actualPrice",
  "startDate",
  "endDate",
  "careCenter",
  "voucherClient",
  "breastPump",
  "serviceStatus",
] as const;

export type ClientWizardFieldId = typeof CLIENT_WIZARD_FIELD_IDS[number];

export interface ClientWizardStructuredError {
  detail: string;
  fieldId?: ClientWizardFieldId;
  label: string;
  pointer: string;
  summaryId: string;
}

const FIELD_POINTERS: Readonly<Record<string, ClientWizardFieldId>> = {
  "/name": "name",
  "/phone": "phone",
  "/birthday": "birthday",
  "/dueDate": "dueDate",
  "/due_date": "dueDate",
  "/birthDate": "birthDate",
  "/birth_date": "birthDate",
  "/address": "address",
  "/primaryEmployeeId": "primaryEmployeeId",
  "/primary_employee_id": "primaryEmployeeId",
  "/secondaryEmployeeId": "secondaryEmployeeId",
  "/secondary_employee_id": "secondaryEmployeeId",
  "/type": "type",
  "/duration": "duration",
  "/fullPrice": "fullPrice",
  "/full_price": "fullPrice",
  "/grant": "grant",
  "/actualPrice": "actualPrice",
  "/actual_price": "actualPrice",
  "/startDate": "startDate",
  "/start_date": "startDate",
  "/endDate": "endDate",
  "/end_date": "endDate",
  "/careCenter": "careCenter",
  "/care_center": "careCenter",
  "/voucherClient": "voucherClient",
  "/voucher_client": "voucherClient",
  "/breastPump": "breastPump",
  "/breast_pump": "breastPump",
  "/serviceStatus": "serviceStatus",
  "/service_status": "serviceStatus",
};

const FIELD_LABEL_KEYS: Readonly<Record<ClientWizardFieldId, string>> = {
  name: "clients.form.name",
  phone: "clients.form.phone",
  birthday: "clients.form.birthday",
  dueDate: "clients.form.due-date",
  birthDate: "clients.form.birth-date",
  address: "clients.form.address",
  primaryEmployeeId: "clients.form.primary-employee",
  secondaryEmployeeId: "clients.form.secondary-employee",
  type: "clients.form.voucher-type",
  duration: "clients.form.duration",
  fullPrice: "clients.form.full-price",
  grant: "clients.form.grant",
  actualPrice: "clients.form.actual-price",
  startDate: "clients.form.start-date",
  endDate: "clients.form.end-date",
  careCenter: "clients.form.care-center",
  voucherClient: "clients.form.voucher-client",
  breastPump: "clients.form.breast-pump",
  serviceStatus: "clients.form.contract-status",
};

const FIELD_LABEL_FALLBACKS: Readonly<Record<ClientWizardFieldId, Readonly<Record<Locale, string>>>> = {
  name: { ko: "이름", en: "Name" },
  phone: { ko: "연락처", en: "Phone" },
  birthday: { ko: "생년월일", en: "Birthday" },
  dueDate: { ko: "출산 예정일", en: "Expected delivery date" },
  birthDate: { ko: "출산일", en: "Birth date" },
  address: { ko: "주소", en: "Address" },
  primaryEmployeeId: { ko: "주 담당 인력", en: "Primary provider" },
  secondaryEmployeeId: { ko: "보조 담당 인력", en: "Secondary provider" },
  type: { ko: "바우처 유형", en: "Voucher type" },
  duration: { ko: "서비스 기간", en: "Service duration" },
  fullPrice: { ko: "총 서비스 금액", en: "Total service amount" },
  grant: { ko: "정부지원금", en: "Government grant" },
  actualPrice: { ko: "본인부담금", en: "Out-of-pocket amount" },
  startDate: { ko: "시작일", en: "Start date" },
  endDate: { ko: "종료일", en: "End date" },
  careCenter: { ko: "조리원 이용", en: "Postpartum care center" },
  voucherClient: { ko: "바우처 고객", en: "Voucher client" },
  breastPump: { ko: "유축기 대여", en: "Breast pump rental" },
  serviceStatus: { ko: "계약 상태", en: "Contract status" },
};

const FIELD_STEPS: Readonly<Record<ClientWizardFieldId, number>> = {
  name: 0,
  phone: 0,
  birthday: 0,
  dueDate: 0,
  birthDate: 0,
  address: 0,
  primaryEmployeeId: 1,
  secondaryEmployeeId: 1,
  type: 1,
  duration: 1,
  fullPrice: 1,
  grant: 1,
  actualPrice: 1,
  startDate: 2,
  endDate: 2,
  careCenter: 1,
  voucherClient: 1,
  breastPump: 1,
  serviceStatus: 2,
};

export function getClientWizardFieldId(problemError: ProblemError): ClientWizardFieldId | undefined {
  if (problemError.location !== undefined && problemError.location !== "body") {
    return undefined;
  }

  return FIELD_POINTERS[problemError.pointer];
}

export function getClientWizardFieldStep(fieldId: ClientWizardFieldId): number {
  return FIELD_STEPS[fieldId];
}

function getClientWizardFieldLabel(fieldId: ClientWizardFieldId, locale: Locale): string {
  const key = FIELD_LABEL_KEYS[fieldId];
  const translated = t(locale, key);
  return translated === key ? FIELD_LABEL_FALLBACKS[fieldId][locale] : translated;
}

export function presentClientWizardErrors(
  errors: readonly ProblemError[],
  locale: Locale,
): ClientWizardStructuredError[] {
  const unmappedField = resolveProblemPresentation(locale).unmappedField;

  return errors.map((problemError, index) => {
    const fieldId = getClientWizardFieldId(problemError);
    return {
      detail: problemError.detail,
      fieldId,
      label: fieldId ? getClientWizardFieldLabel(fieldId, locale) : unmappedField,
      pointer: problemError.pointer || "/",
      summaryId: `${CLIENT_WIZARD_ERROR_SUMMARY_ID}_item-${index}`,
    };
  });
}
