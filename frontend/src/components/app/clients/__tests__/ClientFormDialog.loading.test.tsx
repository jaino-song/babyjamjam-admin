import { render, screen } from "@testing-library/react";

import { api } from "@/lib/api/client";

import { ClientFormDialog, ClientFormPanel } from "../ClientFormDialog";

let mockPending = false;
let mockAreasLoading = true;
const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: mockPending, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: mockPending, mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAvailableClientAreas: () => ({
    data: [
      { id: "Namdonggu", name: "Namdong-gu", koreanName: "남동구" },
      { id: "Seogu", name: "Seo-gu", koreanName: "서구" },
      { id: "Yeonsugu", name: "Yeonsu-gu", koreanName: "연수구" },
      { id: "GlobalSupport", name: "Global support", koreanName: "공통 지원 지역" },
    ],
    isLoading: mockAreasLoading,
  }),
  useAreaTemplates: () => ({
    data: [
      { id: "area-template-1", areaId: "Namdonggu", templateId: "template-1", templateName: "남동구 계약서" },
      { id: "area-template-2", areaId: "Seogu", templateId: "template-2", templateName: "서구 계약서" },
    ],
    isLoading: false,
  }),
  useOutOfPocketPriceInfos: () => ({ data: [], isError: false, isLoading: false }),
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [], isLoading: false }),
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

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

describe("Client form loading presentations", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockPending = false;
    mockAreasLoading = true;
  });

  it.each(["dialog", "panel"] as const)("shows an empty disabled area select and an accessible spinner in %s", (surface) => {
    render(surface === "dialog"
      ? <ClientFormDialog open onClose={jest.fn()} />
      : <ClientFormPanel open onClose={jest.fn()} />);
    const select = screen.getByRole("combobox", { name: "관할 지역" });
    expect(select).toBeDisabled();
    expect(select.querySelector('option[value=""]')).toHaveTextContent("");
    const status = screen.getByRole("status", { name: "지역을 불러오는 중" });
    expect(status).toHaveAttribute("data-source-component", "LoadingState");
    expect(status.querySelector(".sr-only")).toHaveTextContent("지역을 불러오는 중");
    expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the idle submit content hidden and announces registration while pending", () => {
    mockPending = true;
    mockAreasLoading = false;
    render(<ClientFormDialog open onClose={jest.fn()} />);
    const button = screen.getByRole("button", { name: "등록 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  });
});
