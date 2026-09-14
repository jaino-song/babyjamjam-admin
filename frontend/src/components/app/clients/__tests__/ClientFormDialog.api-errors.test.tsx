import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createProblemDetails } from "@babyjamjam/shared";
import { api } from "@/lib/api/client";
import { ClientFormDialog, ClientFormPanel } from "../ClientFormDialog";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockCreateClientMutateAsync = jest.fn();
const mockUpdateClientMutateAsync = jest.fn();

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClientMutateAsync }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClientMutateAsync }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAvailableClientAreas: () => ({ data: [], isLoading: false }),
  useAreaTemplates: () => ({ data: [], isLoading: false }),
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

const flushOpenEffect = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const fillRequiredFields = () => {
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "홍길동" } });
  fireEvent.change(screen.getByLabelText(/생년월일/), { target: { value: "900101" } });
  fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "서울시 강남구" } });
  fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
};

describe("ClientFormDialog API errors", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClientMutateAsync.mockReset();
    mockUpdateClientMutateAsync.mockReset();
  });

  it("renders every structured field error, preserves values, and links dialog inputs", async () => {
    const requestId = "req-bjj-319-fields";
    const problem = createProblemDetails({
      code: "VALIDATION_FAILED",
      requestId,
      status: 422,
      errors: [
        { pointer: "/name", code: "REQUIRED", detail: "ignored" },
        { pointer: "/phone", code: "INVALID_FORMAT", detail: "ignored" },
        { pointer: "/internalTenantId", code: "OUT_OF_RANGE", detail: "ignored" },
      ],
    });
    mockCreateClientMutateAsync.mockRejectedValue({
      response: { status: 422, data: problem },
    });

    render(<ClientFormDialog open onClose={jest.fn()} />);
    await flushOpenEffect();
    fillRequiredFields();

    const submitButton = screen.getByRole("button", { name: "생성" });
    await waitFor(() => expect(submitButton).toBeEnabled());
    fireEvent.click(submitButton);

    expect(await screen.findByText("이름: 필수 항목이에요.")).toBeInTheDocument();
    expect(screen.getByText("연락처: 입력 형식이 올바르지 않아요.")).toBeInTheDocument();
    expect(screen.getByText(`요청 ID: ${requestId}`)).toBeInTheDocument();
    expect(screen.getByText("입력 항목: 허용 범위를 벗어난 값이에요.")).toBeInTheDocument();
    expect(screen.queryByText(/internalTenantId/)).not.toBeInTheDocument();

    const nameInput = screen.getByLabelText(/이름/);
    const phoneInput = screen.getByLabelText(/연락처/);
    expect(nameInput).toHaveValue("홍길동");
    expect(phoneInput).toHaveValue("010-1234-5678");
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput.getAttribute("aria-describedby")).toContain("desktop_clients_form-dialog_error_0");
    expect(phoneInput.getAttribute("aria-describedby")).toContain("desktop_clients_form-dialog_error_1");

    fireEvent.click(screen.getByRole("button", { name: "이름: 필수 항목이에요." }));
    expect(document.activeElement).toBe(nameInput);
    fireEvent.click(screen.getByRole("button", { name: "연락처: 입력 형식이 올바르지 않아요." }));
    expect(document.activeElement).toBe(phoneInput);
  });

  it("moves panel field errors to step zero and focuses linked inputs", async () => {
    const requestId = "req-bjj-319-panel";
    const problem = createProblemDetails({
      code: "VALIDATION_FAILED",
      requestId,
      status: 422,
      errors: [
        { pointer: "/name", code: "REQUIRED", detail: "ignored" },
        { pointer: "/phone", code: "INVALID_FORMAT", detail: "ignored" },
      ],
    });
    mockCreateClientMutateAsync.mockRejectedValue({
      response: { status: 422, data: problem },
    });

    function PanelHarness() {
      const [step, setStep] = useState(3);
      return (
        <ClientFormPanel
          open
          activeStep={step}
          onActiveStepChange={setStep}
          onClose={jest.fn()}
          prefill={{
            name: "홍길동",
            birthday: "900101",
            address: "서울시 강남구",
            phone: "01012345678",
          }}
        />
      );
    }

    render(<PanelHarness />);
    await flushOpenEffect();
    const submitButton = screen.getByRole("button", { name: "생성" });
    await waitFor(() => expect(submitButton).toBeEnabled());
    fireEvent.click(submitButton);

    expect(await screen.findByText("이름: 필수 항목이에요.")).toBeInTheDocument();
    expect(screen.getByLabelText(/이름/)).toHaveValue("홍길동");
    expect(screen.getByLabelText(/연락처/)).toHaveValue("01012345678");

    fireEvent.click(screen.getByRole("button", { name: "연락처: 입력 형식이 올바르지 않아요." }));
    expect(document.activeElement).toBe(screen.getByLabelText(/연락처/));
  });

  it.each([
    ["transport", new Error("transport failed")],
    ["server problem", { response: { status: 500, data: createProblemDetails({
      code: "INTERNAL_ERROR", requestId: "req-unknown", outcome: "UNKNOWN",
    }) } }],
  ])("keeps an unknown %s mutation outcome blocked after edits", async (_kind, failure) => {
    mockCreateClientMutateAsync.mockRejectedValue(failure);

    render(<ClientFormDialog open onClose={jest.fn()} />);
    await flushOpenEffect();
    fillRequiredFields();

    const submitButton = screen.getByRole("button", { name: "생성" });
    await waitFor(() => expect(submitButton).toBeEnabled());
    fireEvent.click(submitButton);
    expect(await screen.findByText("다시 실행하기 전에 작업 상태를 확인해 주세요.")).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "김길동" } });
    expect(screen.getByText("다시 실행하기 전에 작업 상태를 확인해 주세요.")).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);
    expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(1);
  });
});
