"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useEmployees } from "@/hooks/useEmployees";
import type { ContractReissueOptions } from "@/components/app/clients/ServiceScheduleContractResendModal";
import { useFormStore } from "@/stores/form-store";
import type { Client } from "@/lib/client/types";

function contractPrefillDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnlyMatch) return dateOnlyMatch[1];

  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) {
    const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const date = new Date(`${iso}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return iso;
  }

  if (digits.length === 6) {
    const yy = Number(digits.slice(0, 2));
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const iso = `${year}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
    const date = new Date(`${iso}T00:00:00`);
    if (!Number.isNaN(date.getTime())) return iso;
  }

  return undefined;
}

/** Opens contract creation prefilled from a client, optionally as a re-issue. */
export function useIssueContract() {
  const router = useRouter();
  const { data: employees = [] } = useEmployees();
  const prefillContractCreation = useFormStore((state) => state.prefillFromContract);

  return useCallback((target: Client, reissue?: ContractReissueOptions) => {
    const primaryEmployee =
      employees.find((employee) => employee.id === target.primaryEmployee?.id) ??
      employees.find((employee) => employee.name.trim() === target.primaryEmployee?.name?.trim());
    const secondaryEmployee = target.secondaryEmployee
      ? employees.find((employee) => employee.id === target.secondaryEmployee?.id)
      : undefined;

    prefillContractCreation({
      clientId: target.id,
      name: target.name,
      phone: target.phone ?? "",
      birthday: target.birthday ?? "",
      dueDate: contractPrefillDate(target.dueDate),
      address: target.address ?? "",
      employeeId: primaryEmployee?.id ?? target.primaryEmployee?.id ?? null,
      employeeName: primaryEmployee?.name ?? target.primaryEmployee?.name ?? "",
      employeePhone: primaryEmployee?.phone ?? "",
      employee2Id: secondaryEmployee?.id ?? target.secondaryEmployee?.id ?? null,
      employee2Name: secondaryEmployee?.name ?? target.secondaryEmployee?.name ?? "",
      employee2Phone: secondaryEmployee?.phone ?? target.secondaryEmployee?.phone ?? "",
      startDate: contractPrefillDate(target.startDate),
      endDate: contractPrefillDate(target.endDate),
      fullPrice: target.fullPrice ?? "",
      grant: target.grant ?? "",
      actualPrice: target.actualPrice ?? "",
      paymentDate: reissue?.paymentDate,
      isContractReissue: reissue != null,
      supersedeDocumentId: reissue?.supersedeDocumentId,
      voucherType: target.type ?? "",
      voucherDuration: target.duration != null ? String(target.duration) : "",
      area: target.areaId ?? "",
    });
    router.push("/contracts/new");
  }, [employees, prefillContractCreation, router]);
}
