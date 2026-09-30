import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { EmployeeFormDialog } from "../EmployeeFormDialog";

const mockCreateEmployeeMutateAsync = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: jest.fn().mockResolvedValue(undefined) }),
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
  api: {
    get: jest.fn(),
  },
}));

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

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

const FIELD_MESSAGE_SELECTOR = '[data-slot="field-message"], [data-slot="field-error-message"]';

async function openDialog() {
  render(<EmployeeFormDialog open onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe("EmployeeFormDialog inline field messages", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateEmployeeMutateAsync.mockReset();
  });

  it("shows no field message on first render", async () => {
    await openDialog();

    expect(document.querySelectorAll(FIELD_MESSAGE_SELECTOR)).toHaveLength(0);
    expect(screen.getByLabelText("생년월일")).toHaveAttribute("placeholder", "1958-03-03");
  });

  it("shows the required message only after a typed name is cleared", async () => {
    await openDialog();
    const name = screen.getByLabelText(/이름/);

    fireEvent.focus(name);
    fireEvent.blur(name);
    expect(screen.queryByText("이름을 입력해 주세요")).not.toBeInTheDocument();

    fireEvent.change(name, { target: { value: "김" } });
    fireEvent.change(name, { target: { value: "" } });

    expect(screen.getByText("이름을 입력해 주세요")).toBeInTheDocument();
  });

  it("reports a partial phone number as a format problem, not as a missing one", async () => {
    await openDialog();
    const phone = screen.getByLabelText(/연락처/);

    fireEvent.focus(phone);
    fireEvent.change(phone, { target: { value: "0101234" } });
    expect(screen.getByText("010-1234-5678 형식")).toBeInTheDocument();

    fireEvent.blur(phone);

    const message = screen.getByText("010-1234-5678 형식으로 입력해 주세요");
    expect(screen.queryByText("연락처를 입력해 주세요")).not.toBeInTheDocument();
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAttribute("aria-describedby", message.id);
    expect(message.compareDocumentPosition(phone)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("reveals every problem on submit, focuses the first one and does not save", async () => {
    await openDialog();
    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "1958" } });

    fireEvent.click(document.querySelector<HTMLButtonElement>(
      '[data-component="desktop_employees_form-dialog_submit"]',
    )!);

    expect(screen.getByText("이름을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("연락처를 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("YYYY-MM-DD 형식으로 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("근무 지역을 선택해 주세요")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/이름/));
    expect(mockCreateEmployeeMutateAsync).not.toHaveBeenCalled();
  });
});
