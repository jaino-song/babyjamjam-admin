import { normalizeContractBirthday } from "@babyjamjam/shared/utils/birthday";

import type { ClientWizardPrefill } from "@/stores/client-dialog-store";
import type { ContractCreationPrefill } from "@/stores/form-store";

export interface ContractClientPrefillInput {
  name?: string | null;
  phone?: string | null;
  birthday?: string | null;
  dueDate?: string | null;
  address?: string | null;
  type?: string | null;
  duration?: number | null;
  fullPrice?: string | null;
  grant?: string | null;
  actualPrice?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Converts the values extracted by the contracts page into the client dialog
 * prefill. Service dates are already normalized by the page's existing
 * normalizeDateToYymmdd helper; only birthdays use the shared validator.
 */
export function buildContractClientPrefill(
  input: ContractClientPrefillInput,
  now: Date = new Date(),
): ClientWizardPrefill {
  const prefill: ClientWizardPrefill = {};
  const name = input.name?.trim();
  if (name && name !== "고객 미지정") prefill.name = name;
  if (input.phone) prefill.phone = input.phone;

  const birthday = normalizeContractBirthday(input.birthday, now) ?? undefined;
  if (birthday) prefill.birthday = birthday;
  if (input.dueDate) prefill.dueDate = input.dueDate;
  if (input.address) prefill.address = input.address;
  if (input.type) prefill.type = input.type;
  if (input.duration !== undefined) prefill.duration = input.duration;
  if (input.fullPrice) prefill.fullPrice = input.fullPrice;
  if (input.grant) prefill.grant = input.grant;
  if (input.actualPrice) prefill.actualPrice = input.actualPrice;
  if (input.startDate) prefill.startDate = input.startDate;
  if (input.endDate) prefill.endDate = input.endDate;

  return prefill;
}

export interface ContractCreationPrefillInput {
  clientPrefill: ClientWizardPrefill;
  clientId?: number | null;
  employeeId?: number;
  employeeName?: string;
  employeePhone?: string;
  dueDate?: string;
  startDate?: string;
  endDate?: string;
  paymentDate?: string;
}

/**
 * Maps the client prefill into the contract recreation form while preserving
 * the normalized birthday and the service-date fallbacks resolved by the page.
 */
export function buildContractCreationPrefillFromClient({
  clientPrefill,
  clientId,
  employeeId,
  employeeName,
  employeePhone,
  dueDate,
  startDate,
  endDate,
  paymentDate,
}: ContractCreationPrefillInput): ContractCreationPrefill {
  return {
    clientId: clientId ?? null,
    name: clientPrefill.name,
    phone: clientPrefill.phone,
    birthday: clientPrefill.birthday,
    dueDate,
    address: clientPrefill.address,
    employeeId,
    employeeName,
    employeePhone,
    startDate,
    endDate,
    fullPrice: clientPrefill.fullPrice,
    grant: clientPrefill.grant,
    actualPrice: clientPrefill.actualPrice,
    paymentDate,
    voucherType: clientPrefill.type,
    voucherDuration: clientPrefill.duration != null ? String(clientPrefill.duration) : undefined,
    area: "",
  };
}
