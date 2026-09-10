import { normalizeContractBirthday } from "@babyjamjam/shared/utils/birthday";
import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";

import type { ClientWizardPrefill } from "@/stores/client-dialog-store";
import { formatKoreanPhoneNumber } from "@/lib/phone";

/**
 * Maps the server-validated eformsign contract candidate into the client
 * registration wizard's create-mode prefill.
 *
 * The candidate endpoint is the source of truth for values extracted from a
 * completed contract. Keep nulls as the wizard's explicit empty defaults so a
 * stale prefill can never leak into a manual registration.
 */
export function contractCandidateToClientPrefill(
  candidate: EformsignContractClientCandidateResponse,
  now: Date = new Date(),
): ClientWizardPrefill {
  const today = localDateOnly(now);

  return {
    name: candidate.name ?? "",
    phone: formatKoreanPhoneNumber(candidate.phone),
    address: candidate.address ?? "",
    birthday: normalizeContractBirthday(candidate.birthday, now) ?? "",
    dueDate: candidate.dueDate ?? "",
    startDate: candidate.startDate ?? "",
    endDate: candidate.endDate ?? "",
    primaryEmployeeId: candidate.primaryEmployeeId,
    secondaryEmployeeId: candidate.secondaryEmployeeId,
    type: candidate.type ?? "",
    duration: candidate.duration,
    fullPrice: candidate.fullPrice ?? "",
    grant: candidate.grant ?? "",
    actualPrice: candidate.actualPrice ?? "",
    careCenter: candidate.careCenter ?? false,
    voucherClient: candidate.voucherClient,
    breastPump: candidate.breastPump,
    serviceStatus: candidate.startDate && candidate.startDate < today
      ? "active"
      : "pre_booking",
  };
}

function localDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
