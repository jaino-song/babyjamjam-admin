import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "@/lib/api/client";
import type { Employee } from "@/hooks/useEmployees";

import { EmployeeFormDialog } from "../EmployeeFormDialog";

const mockCreateEmployeeMutateAsync = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: jest.fn() }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  employeeQueryKeys: { all: ["employees"] },
  useCreateEmployee: () => ({ isPending: false, mutateAsync: mockCreateEmployeeMutateAsync }),
  useUpdateEmployee: () => ({ isPending: false, mutateAsync: jest.fn() }),
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
  api: { get: jest.fn() },
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

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

const nameInput = () => screen.getByLabelText(/^이름/);
const phoneInput = () => screen.getByLabelText(/^연락처/);
const birthdayInput = () => screen.getByLabelText("생년월일");
const slotOf = (input: HTMLElement) =>
  document.getElementById(input.getAttribute("aria-describedby") ?? "") as HTMLElement;

const renderDialog = async (employee?: Employee) => {
  render(<EmployeeFormDialog open onClose={jest.fn()} employee={employee} />);
  await act(async () => {
    await Promise.resolve();
  });
};

describe("EmployeeFormDialog field messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
  });

  it("shows no message on first load and keeps the save button pressable", async () => {
    await renderDialog();

    [nameInput(), phoneInput(), birthdayInput()].forEach((input) => {
      expect(slotOf(input)).toBeEmptyDOMElement();
      expect(input).not.toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByRole("button", { name: "등록" })).toBeEnabled();
  });

  it("reports a required field only after it held a value and was cleared", async () => {
    await renderDialog();

    fireEvent.change(nameInput(), { target: { value: "김" } });
    expect(slotOf(nameInput())).toBeEmptyDOMElement();

    fireEvent.change(nameInput(), { target: { value: "" } });
    expect(slotOf(nameInput())).toHaveTextContent("이름을 입력해 주세요");
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(slotOf(nameInput())).toHaveAttribute("aria-live", "polite");
  });

  it("hints while a phone number is incomplete and focused, then errors once left", async () => {
    await renderDialog();

    fireEvent.focus(phoneInput());
    fireEvent.change(phoneInput(), { target: { value: "0101234" } });
    expect(slotOf(phoneInput())).toHaveTextContent("010-1234-5678 형식");
    expect(slotOf(phoneInput())).not.toHaveTextContent("입력해 주세요");
    expect(phoneInput()).not.toHaveAttribute("aria-invalid", "true");

    fireEvent.blur(phoneInput());
    expect(slotOf(phoneInput())).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
    expect(phoneInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("does not accept a landline: the employee needs a mobile number", async () => {
    await renderDialog();

    fireEvent.change(phoneInput(), { target: { value: "0311234567" } });
    fireEvent.blur(phoneInput());
    expect(slotOf(phoneInput())).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
    expect(phoneInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("types a birthday as digits with auto-inserted hyphens and a realistic placeholder", async () => {
    await renderDialog();

    expect(birthdayInput()).toHaveAttribute("placeholder", "1958-03-03");
    fireEvent.change(birthdayInput(), { target: { value: "19580303" } });
    expect(birthdayInput()).toHaveValue("1958-03-03");
    expect(slotOf(birthdayInput())).toBeEmptyDOMElement();
  });

  it("flags a nonexistent or future birthday after the field is left", async () => {
    await renderDialog();

    fireEvent.focus(birthdayInput());
    fireEvent.change(birthdayInput(), { target: { value: "19580231" } });
    fireEvent.blur(birthdayInput());
    expect(slotOf(birthdayInput())).toHaveTextContent("존재하지 않는 날짜예요");

    fireEvent.change(birthdayInput(), { target: { value: "29990101" } });
    expect(slotOf(birthdayInput())).toHaveTextContent("미래 날짜는 입력할 수 없어요");
  });

  it("on save shows every problem, focuses the first one and does not submit", async () => {
    await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));

    expect(slotOf(nameInput())).toHaveTextContent("이름을 입력해 주세요");
    expect(slotOf(phoneInput())).toHaveTextContent("연락처를 입력해 주세요");
    expect(screen.getByText("근무 지역을 선택해 주세요")).toBeInTheDocument();
    expect(nameInput()).toHaveFocus();
    expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();
  });

  it("keeps the duplicate-check status in the phone slot", async () => {
    mockApiGet.mockResolvedValue({ data: { exists: true } });
    await renderDialog();

    fireEvent.change(phoneInput(), { target: { value: "01012345678" } });

    await waitFor(() =>
      expect(slotOf(phoneInput())).toHaveTextContent("이미 등록된 연락처예요"),
    );
    expect(phoneInput()).toHaveAttribute("aria-invalid", "true");
    expect(within(document.body).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a cleared prefilled value in edit mode as a missing required field", async () => {
    await renderDialog({
      id: 1,
      name: "김관리",
      phone: "010-1234-5678",
      workArea: ["인천 부평구"],
      grade: "스탠다드",
      openToNextWork: true,
      birthday: "1958-03-03",
    } as unknown as Employee);

    expect(slotOf(nameInput())).toBeEmptyDOMElement();
    fireEvent.change(nameInput(), { target: { value: "" } });
    expect(slotOf(nameInput())).toHaveTextContent("이름을 입력해 주세요");
  });
});
