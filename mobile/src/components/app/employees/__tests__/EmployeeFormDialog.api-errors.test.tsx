import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared";
import { api } from "@/lib/api/client";
import { EmployeeFormDialog } from "../EmployeeFormDialog";

const mockCreateEmployeeMutateAsync = jest.fn();
const mockUpdateEmployeeMutateAsync = jest.fn();
const mockRefetchQueries = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  employeeQueryKeys: { all: ["employees"] },
  useCreateEmployee: () => ({ isPending: false, mutateAsync: mockCreateEmployeeMutateAsync }),
  useUpdateEmployee: () => ({ isPending: false, mutateAsync: mockUpdateEmployeeMutateAsync }),
}));

jest.mock("@/stores/employee-dialog-store", () => {
  const state = { prefillName: "" };

  return {
    useEmployeeDialogStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
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

jest.mock("@/components/app/mobile-redesign/mobile-detail-slideup", () => ({
  MobileDetailSlideUp: ({
    children,
    primaryAction,
  }: {
    children: React.ReactNode;
    primaryAction: { label: string; onClick: () => void; disabled: boolean };
  }) => (
    <div>
      {children}
      <button type="button" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
        {primaryAction.label}
      </button>
    </div>
  ),
}));

jest.mock("../EmployeeFormCard", () => ({
  EmployeeFormCard: ({
    formData,
    phoneHelperMessage,
    onChange,
  }: {
    formData: { name: string; phone: string };
    phoneHelperMessage?: string | null;
    onChange: (field: string, value: unknown) => void;
  }) => (
    <div>
      <label htmlFor="employee-form-name">이름</label>
      <input
        id="employee-form-name"
        value={formData.name}
        onChange={(event) => onChange("name", event.target.value)}
      />
      <label htmlFor="employee-form-phone">연락처</label>
      <input
        id="employee-form-phone"
        value={formData.phone}
        onChange={(event) => onChange("phone", event.target.value)}
      />
      <button type="button" onClick={() => onChange("workArea", ["남동구"])}>
        근무 지역 선택
      </button>
      {phoneHelperMessage ? <p>{phoneHelperMessage}</p> : null}
    </div>
  ),
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

const fillAndSubmit = async (failure: unknown) => {
  mockCreateEmployeeMutateAsync.mockRejectedValue(failure);

  render(<EmployeeFormDialog open onClose={jest.fn()} />);

  await act(async () => {
    await Promise.resolve();
  });

  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "김관리" } });
  fireEvent.click(screen.getByRole("button", { name: "근무 지역 선택" }));
  fireEvent.change(screen.getByLabelText("연락처"), { target: { value: "01012345678" } });

  await screen.findByText("등록 가능한 번호입니다.");

  const submit = screen.getByRole("button", { name: "등록" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
};

describe("EmployeeFormDialog (mobile) API errors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateEmployeeMutateAsync.mockReset();
    mockUpdateEmployeeMutateAsync.mockReset();
  });

  it("renders structured field errors, the request id, and focuses the linked field",
    async () => {
      const requestId = "req-bjj-319-mobile-fields";
      const problem = createProblemDetails({
        code: "VALIDATION_FAILED",
        requestId,
        status: 422,
        errors: [
          { pointer: "/name", code: "REQUIRED", detail: "ignored" },
          { pointer: "/phone", code: "INVALID_FORMAT", detail: "ignored" },
        ],
      });

      await fillAndSubmit({ response: { status: 422, data: problem } });

      expect(await screen.findByText("이름: 필수 항목이에요.")).toBeInTheDocument();
      expect(screen.getByText("연락처: 입력 형식이 올바르지 않아요.")).toBeInTheDocument();
      expect(screen.getByText(`요청 ID: ${requestId}`)).toBeInTheDocument();

      fireEvent.click(screen.getByText("이름: 필수 항목이에요."));
      expect(document.activeElement).toBe(screen.getByLabelText("이름"));
    });

  it("shows the catalog message for a problem 409 duplicate", async () => {
    await fillAndSubmit({
      response: {
        status: 409,
        data: createProblemDetails({
          code: "EMPLOYEE_PHONE_ALREADY_REGISTERED",
          requestId: "req-bjj-319-mobile-dup",
          status: 409,
        }),
      },
    });

    expect(
      await screen.findByText("같은 전화번호의 관리사가 이미 등록되어 있어요."),
    ).toBeInTheDocument();
  });

  it("keeps the legacy mapper message for an unstructured error", async () => {
    await fillAndSubmit({
      response: {
        status: 409,
        data: { statusCode: 409, code: "P2002", error: "Conflict", field: "phone" },
      },
    });

    expect(await screen.findByText("연락처 정보가 이미 등록돼 있어요.")).toBeInTheDocument();
  });
});
