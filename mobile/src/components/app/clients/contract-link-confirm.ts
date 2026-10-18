import type { EformsignLinkConfirmation } from "@/services/api";

type Field = EformsignLinkConfirmation["differences"][number];
export type ContractLinkChoices = Partial<Record<Field, string>>;
export interface ContractLinkRow {
  field: Field;
  label: string;
  documentValue: string | null;
  clientValue: string | null;
  needsChoice: boolean;
}

export function contractLinkRows(entry: EformsignLinkConfirmation): ContractLinkRow[] {
  return entry.differences.map(field => {
    const documentValue = entry.document[field] || null;
    const clientValue = entry.client[field] || null;
    return { field, label: field === "name" ? "이름" : "생년월일", documentValue, clientValue, needsChoice: Boolean(documentValue || clientValue) };
  });
}

export function canConfirmContractLink(entry: EformsignLinkConfirmation, choices: ContractLinkChoices): boolean {
  return entry.canConfirm && contractLinkRows(entry).every(row => !row.needsChoice ||
    (choices[row.field] === "document" && Boolean(row.documentValue)) ||
    (choices[row.field] === "client" && Boolean(row.clientValue)));
}

export function buildContractLinkUpdate(entry: EformsignLinkConfirmation, choices: ContractLinkChoices): { name?: string; birthday?: string } {
  const dto: { name?: string; birthday?: string } = {};
  for (const row of contractLinkRows(entry)) {
    if (choices[row.field] === "document" && row.documentValue) dto[row.field] = row.documentValue;
  }
  return dto;
}
