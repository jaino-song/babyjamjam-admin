import type { CreateClientDto } from "@/features/clients/types";

export interface ContractAutoRegistrationPayloadInput {
  name: string;
  phone: string;
  birthday?: string;
  address?: string;
  dueDate?: string;
  primaryEmployeeId: number | null;
  secondaryEmployeeId: number | null;
}

export function buildContractAutoRegistrationPayload(
  input: ContractAutoRegistrationPayloadInput,
): CreateClientDto {
  return {
    name: input.name,
    phone: input.phone,
    birthday: input.birthday,
    address: input.address,
    dueDate: input.dueDate,
    primaryEmployeeId: input.primaryEmployeeId,
    secondaryEmployeeId: input.secondaryEmployeeId,
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    source: "contract_auto_registration",
  };
}
