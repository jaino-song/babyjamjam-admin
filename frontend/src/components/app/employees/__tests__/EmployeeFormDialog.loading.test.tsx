import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { EmployeeFormDialog, EmployeeFormPanel } from "../EmployeeFormDialog";

const mockCreateEmployeeMutateAsync = jest.fn();
const mockUpdateEmployeeMutateAsync = jest.fn();
const mockToast = jest.fn();

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  employeeQueryKeys: { all: ["employees"] },
  useCreateEmployee: () => ({ isPending: true, mutateAsync: mockCreateEmployeeMutateAsync }),
  useUpdateEmployee: () => ({ isPending: true, mutateAsync: mockUpdateEmployeeMutateAsync }),
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

describe.each(["dialog", "panel"] as const)("Employee %s form busy submission", (surface) => {
  it("retains the idle content and supplies an accessible registration spinner", () => {
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    render(surface === "dialog"
      ? <EmployeeFormDialog open onClose={jest.fn()} />
      : <EmployeeFormPanel open onClose={jest.fn()} />);
    const button = screen.getByRole("button", { name: "등록 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(button.querySelector('[data-slot="button-spinner"] svg')).toHaveAttribute("aria-hidden", "true");
  });
});
