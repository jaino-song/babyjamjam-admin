import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
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

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
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

const FIELD_MESSAGE_SELECTOR = '[data-slot="field-message"], [data-slot="field-error-message"]';

async function renderPage() {
  render(<NewClientPage />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("NewClientPage inline field messages", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset();
    act(() => {
      useClientWizardStore.getState().reset();
    });
  });

  it("shows no field message on first render and uses example dates as placeholders", async () => {
    await renderPage();

    expect(document.querySelectorAll(FIELD_MESSAGE_SELECTOR)).toHaveLength(0);
    expect(screen.getByLabelText("생년월일")).toHaveAttribute("placeholder", "1958-03-03");
    expect(screen.getByLabelText("출산 예정일")).toHaveAttribute("placeholder", "2026-11-20");
    expect(screen.getByLabelText("출산일")).toHaveAttribute("placeholder", "2026-11-20");
    expect(screen.getByLabelText("출산일")).toHaveAttribute("type", "text");
  });

  it("shows the required name message only after a typed name is cleared", async () => {
    await renderPage();
    const name = screen.getByLabelText(/이름/);

    fireEvent.focus(name);
    fireEvent.blur(name);
    expect(screen.queryByText("이름을 입력해 주세요")).not.toBeInTheDocument();

    fireEvent.change(name, { target: { value: "홍" } });
    fireEvent.change(name, { target: { value: "" } });

    const message = screen.getByText("이름을 입력해 주세요");
    expect(message.compareDocumentPosition(name)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", message.id);
  });

  it("reports a partial phone number as a format problem once the field is left", async () => {
    await renderPage();
    const phone = screen.getByLabelText(/연락처/);

    fireEvent.focus(phone);
    fireEvent.change(phone, { target: { value: "0101234" } });
    expect(screen.getByText("010-1234-5678 형식")).toBeInTheDocument();

    fireEvent.blur(phone);

    expect(screen.getByText("010-1234-5678로 입력해 주세요")).toBeInTheDocument();
    expect(screen.queryByText("연락처를 입력해 주세요")).not.toBeInTheDocument();
  });

  it("formats typed dates as YYYY-MM-DD", async () => {
    await renderPage();

    fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20261120" } });

    expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-11-20");
  });

  it("lets Next reveal the missing required fields and focuses the first one", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("이름을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("연락처를 입력해 주세요")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/이름/));
    expect(document.querySelector('[data-component="desktop_clients-new_basic_step_error"]')).toBeNull();
  });

  it("reports an end date before the start date on the contract step", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "홍길동" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
    await waitFor(() => expect(mockApiGet).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(await screen.findByRole("button", { name: "다음" }));

    fireEvent.change(await screen.findByLabelText("시작일"), { target: { value: "20261201" } });
    expect(screen.getByLabelText("시작일")).toHaveValue("2026-12-01");
    expect(screen.getByLabelText("시작일")).toHaveAttribute("placeholder", "2026-12-01");

    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "20261119" } });

    expect(screen.getByText("종료일은 시작일 이후여야 해요")).toBeInTheDocument();
    expect(screen.getByLabelText("종료일")).toHaveAttribute("aria-invalid", "true");
  });
});
