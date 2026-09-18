import { fireEvent, render, screen } from "@testing-library/react";

import ContractSendWizard from "./ContractSendWizard";
import type { Client } from "@/lib/client/types";

const mockPush = jest.fn();
let mockClients: Client[] = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: mockClients, isLoading: false }),
}));

const baseClient: Client = {
  id: 1,
  name: "테스트 고객",
  createdAt: "2026-01-01",
  birthday: null,
  dueDate: "2026-10-01",
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
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

function selectClient() {
  const input = screen.getByRole("textbox", { name: /산모 선택/ });
  fireEvent.click(input);
  fireEvent.change(input, {
    target: { value: baseClient.name },
  });
  fireEvent.click(screen.getByText(baseClient.name));
}

describe("ContractSendWizard signed-state copy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClients = [baseClient];
  });

  it("does not show a signing badge for an unsigned client", () => {
    render(<ContractSendWizard />);

    selectClient();

    expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
    expect(screen.queryByText("계약 완료")).not.toBeInTheDocument();
  });

  it("shows 서명 완료 while the provider review is still pending", () => {
    mockClients = [{
      ...baseClient,
      eDocId: "document-1",
      hasSigned: true,
      documentStatus: "requested",
    }];

    render(<ContractSendWizard />);

    selectClient();

    expect(screen.getByText("서명 완료")).toBeInTheDocument();
    expect(screen.queryByText("계약 완료")).not.toBeInTheDocument();
  });

  it("shows 계약 완료 only after the document is completed", () => {
    mockClients = [{
      ...baseClient,
      eDocId: "document-1",
      hasSigned: true,
      documentStatus: "completed",
    }];

    render(<ContractSendWizard />);

    selectClient();

    expect(screen.getByText("계약 완료")).toBeInTheDocument();
    expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
  });
});
