import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createProblemDetails } from "@babyjamjam/shared";
import { api } from "@/lib/api/client";
import { EmployeeFormDialog } from "../EmployeeFormDialog";

const mockCreateEmployeeMutateAsync = jest.fn();
const mockUpdateEmployeeMutateAsync = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  employeeQueryKeys: { all: ["employees"] },
  useCreateEmployee: () => ({ isPending: false, mutateAsync: mockCreateEmployeeMutateAsync }),
  useUpdateEmployee: () => ({ isPending: false, mutateAsync: mockUpdateEmployeeMutateAsync }),
}));

jest.mock("@/stores/employee-dialog-store", () => {
  const state = { prefillName: "" };

  return {
    useEmployeeDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/app/ui/FormDialogShell", () => ({
  FormDialogShell: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

const flushOpenEffect = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const fillRequiredFields = async () => {
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "김관리" } });
  fireEvent.click(screen.getByRole("combobox", { name: /근무 지역 선택/ }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "남동구" }));
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });

  await screen.findByText("등록 가능한 번호입니다.");

  const submitButton = document.querySelector<HTMLButtonElement>(
    '[data-component="desktop_employees_form-dialog_submit"]',
  );
  expect(submitButton).not.toBeNull();
  await waitFor(() => expect(submitButton).toBeEnabled());

  return submitButton!;
};

describe("EmployeeFormDialog API errors", () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateEmployeeMutateAsync.mockReset();
    mockUpdateEmployeeMutateAsync.mockReset();
  });

  it("renders every structured field error, preserves values, and links dialog inputs", async () => {
    const requestId = "req-bjj-319-employee-fields";
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
    mockCreateEmployeeMutateAsync.mockRejectedValue({
      response: { status: 422, data: problem },
    });

    render(<EmployeeFormDialog open onClose={jest.fn()} />);
    await flushOpenEffect();

    const submitButton = await fillRequiredFields();
    fireEvent.click(submitButton);

    expect(await screen.findByText("이름: 필수 항목이에요.")).toBeInTheDocument();
    expect(screen.getByText("연락처: 입력 형식이 올바르지 않아요.")).toBeInTheDocument();
    expect(screen.getByText(`요청 ID: ${requestId}`)).toBeInTheDocument();
    expect(screen.getByText("입력 항목: 허용 범위를 벗어난 값이에요.")).toBeInTheDocument();
    expect(screen.queryByText(/internalTenantId/)).not.toBeInTheDocument();

    const nameInput = screen.getByLabelText(/이름/);
    const phoneInput = screen.getByLabelText(/연락처/);
    expect(nameInput).toHaveValue("김관리");
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput.getAttribute("aria-describedby")).toContain(
      "desktop_employees_form-dialog_error_0",
    );
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    expect(phoneInput.getAttribute("aria-describedby")).toContain(
      "desktop_employees_form-dialog_error_1",
    );
  });

  it("shows the catalog message for a problem 409 duplicate", async () => {
    const problem = createProblemDetails({
      code: "EMPLOYEE_PHONE_ALREADY_REGISTERED",
      requestId: "req-bjj-319-employee-dup",
      status: 409,
    });
    mockCreateEmployeeMutateAsync.mockRejectedValue({
      response: { status: 409, data: problem },
    });

    render(<EmployeeFormDialog open onClose={jest.fn()} />);
    await flushOpenEffect();

    const submitButton = await fillRequiredFields();
    fireEvent.click(submitButton);

    expect(
      await screen.findByText("같은 전화번호의 관리사가 이미 등록되어 있어요."),
    ).toBeInTheDocument();
  });

  it("keeps the legacy mapper message for an unstructured error", async () => {
    mockUpdateEmployeeMutateAsync.mockRejectedValue({
      response: {
        status: 409,
        data: { statusCode: 409, code: "P2002", error: "Conflict", field: "phone" },
      },
    });

    render(
      <EmployeeFormDialog open employee={{
        id: 1,
        name: "김관리",
        workArea: ["남동구"],
        phone: "01012345678",
        grade: "스탠다드",
        openToNextWork: true,
        registeredDate: "2026-07-10",
        status: "available",
      }} onClose={jest.fn()} />,
    );
    await flushOpenEffect();

    const submitButton = document.querySelector<HTMLButtonElement>(
      '[data-component="desktop_employees_form-dialog_submit"]',
    );
    expect(submitButton).not.toBeNull();
    await waitFor(() => expect(submitButton).toBeEnabled());
    fireEvent.click(submitButton!);

    expect(
      await screen.findByText("연락처 정보가 이미 등록돼 있어요."),
    ).toBeInTheDocument();
  });
});
