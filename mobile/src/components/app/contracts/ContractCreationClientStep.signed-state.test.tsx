import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { Client } from "@/lib/client/types";
import type { ContractCreationFlow } from "@/hooks/contracts/useContractCreationFlow";

import { ContractCreationClientStep } from "./ContractCreationClientStep";

jest.mock("@/components/app/ui/form-section", () => ({
  FormSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

const signedClient: Client = {
  id: 7,
  name: "테스트 고객",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: "서울시 강남구",
  phone: "010-4350-2680",
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: null,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: null,
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: null,
  eDocId: "document-1",
  hasSigned: true,
  documentStatus: "requested",
};

function makeFlow(client: Client): ContractCreationFlow {
  return {
    clients: [client],
    selectedClient: null,
    selectedAreaOption: null,
    areaOptions: [],
    form: {
      name: client.name,
      phone: client.phone ?? "",
      birthday: "",
      address: client.address ?? "",
      area: "",
      clientId: null,
      employeeId: null,
      employeeName: "",
      employeePhone: "",
      showEmployee2: false,
      employee2Id: null,
      employee2Name: "",
      employee2Phone: "",
      voucherYear: 2026,
      voucherType: "",
      voucherDuration: "",
      fullPrice: "",
      grant: "",
      actualPrice: "",
      startDate: "",
      endDate: "",
      paymentDate: "",
      startDateInput: "",
      endDateInput: "",
      effectivePaymentDateInput: "",
    },
    actions: {
      selectClient: jest.fn(),
      changeClientName: jest.fn(),
      useManualClient: jest.fn(),
      changePhone: jest.fn(),
      changeBirthday: jest.fn(),
      changeAddress: jest.fn(),
      changeArea: jest.fn(),
    },
  } as unknown as ContractCreationFlow;
}

describe("ContractCreationClientStep signed status", () => {
  it("shows 서명완료 for a signed client in contract selection", () => {
    render(<ContractCreationClientStep flow={makeFlow(signedClient)} />);

    const input = screen.getByRole("textbox", { name: /이름/ });
    fireEvent.focus(input);

    const dropdown = screen.getByTestId("mobile_contracts-new_client_autocomplete_dropdown");
    expect(within(dropdown).getByText("서명완료")).toBeInTheDocument();
  });

  it("does not show a signed badge for an unsigned client", () => {
    render(
      <ContractCreationClientStep
        flow={makeFlow({ ...signedClient, hasSigned: false, eDocId: null, documentStatus: null })}
      />,
    );

    const input = screen.getByRole("textbox", { name: /이름/ });
    fireEvent.focus(input);

    const dropdown = screen.getByTestId("mobile_contracts-new_client_autocomplete_dropdown");
    expect(within(dropdown).queryByText("서명완료")).not.toBeInTheDocument();
  });
});
