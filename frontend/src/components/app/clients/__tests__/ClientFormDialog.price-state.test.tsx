import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Client } from "@/lib/client/types";

import { ClientFormPanel } from "../ClientFormDialog";

let mockVoucherPriceInfos = [
  {
    id: 1,
    type: "A가1형",
    duration: "10",
    fullPrice: "1,464,000",
    grant: "1,002,000",
    actualPrice: "462,000",
  },
];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useVoucherPriceInfos: (type: string) => ({
    data: type ? mockVoucherPriceInfos : [],
    isLoading: false,
  }),
}));

jest.mock("@/stores/client-dialog-store", () => {
  const state = { prefillName: "", clearPrefillName: jest.fn() };

  return {
    useClientDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("../EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => <div data-testid="employee-autocomplete" />,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

describe("ClientFormPanel voucher pricing", () => {
  beforeEach(() => {
    mockVoucherPriceInfos = [
      {
        id: 1,
        type: "A가1형",
        duration: "10",
        fullPrice: "1,464,000",
        grant: "1,002,000",
        actualPrice: "462,000",
      },
    ];
  });

  it("keeps prices blank and disabled until type and duration are selected", async () => {
    render(<ClientFormPanel open activeStep={2} onClose={jest.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    const voucherType = screen.getByLabelText("바우처 유형");
    const duration = screen.getByLabelText("서비스 기간");
    const fullPrice = screen.getByLabelText("총 서비스 금액");
    const grant = screen.getByLabelText("정부지원금");
    const actualPrice = screen.getByLabelText("본인부담금");

    for (const input of [fullPrice, grant, actualPrice]) {
      expect(input).toBeDisabled();
      expect(input).toHaveValue("");
      expect(input).not.toHaveAttribute("placeholder");
    }

    fireEvent.change(voucherType, { target: { value: "A가1형" } });

    await waitFor(() => expect(duration).toBeEnabled());
    for (const input of [fullPrice, grant, actualPrice]) {
      expect(input).toBeDisabled();
      expect(input).toHaveValue("");
    }

    fireEvent.change(duration, { target: { value: "10" } });

    await waitFor(() => {
      expect(fullPrice).toBeEnabled();
      expect(fullPrice).toHaveValue("1,464,000");
      expect(grant).toBeEnabled();
      expect(grant).toHaveValue("1,002,000");
      expect(actualPrice).toBeEnabled();
      expect(actualPrice).toHaveValue("462,000");
    });

    fireEvent.change(fullPrice, { target: { value: "1500000" } });
    expect(fullPrice).toHaveValue("1,500,000");

    fireEvent.change(voucherType, { target: { value: "A통합1형" } });

    await waitFor(() => {
      for (const input of [fullPrice, grant, actualPrice]) {
        expect(input).toBeDisabled();
        expect(input).toHaveValue("");
      }
    });
  });

  it("keeps saved prices editable when an existing client already has type and duration", async () => {
    const client: Client = {
      id: 1,
      name: "김산모",
      createdAt: "2026-01-01",
      birthday: "900101",
      dueDate: "2026-08-01",
      address: "인천시 서구",
      phone: "010-1111-2222",
      primaryEmployee: null,
      secondaryEmployee: null,
      type: "A가1형",
      duration: 10,
      fullPrice: "1,500,000",
      grant: "1,000,000",
      actualPrice: "500,000",
      startDate: null,
      endDate: null,
      careCenter: false,
      voucherClient: true,
      breastPump: false,
      serviceStatus: "waiting",
      eDocId: null,
      hasSigned: false,
      documentStatus: null,
    };
    mockVoucherPriceInfos = [];

    render(
      <ClientFormPanel
        open
        activeStep={2}
        client={client}
        onClose={jest.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText("총 서비스 금액")).toBeEnabled();
    expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,500,000");
    expect(screen.getByLabelText("정부지원금")).toBeEnabled();
    expect(screen.getByLabelText("정부지원금")).toHaveValue("1,000,000");
    expect(screen.getByLabelText("본인부담금")).toBeEnabled();
    expect(screen.getByLabelText("본인부담금")).toHaveValue("500,000");
  });
});
