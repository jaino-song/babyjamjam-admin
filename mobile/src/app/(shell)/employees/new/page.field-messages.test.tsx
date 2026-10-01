import { act, fireEvent, render, screen } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";

import NewEmployeePage from "./page";

const mockCreateEmployee = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useCreateEmployee: () => ({ isPending: false, mutateAsync: mockCreateEmployee }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

const slotOf = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby")?.split(" ")[0] ?? "") as HTMLElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

describe("mobile employee wizard field messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => useEmployeeWizardStore.getState().reset());
    (api.get as jest.Mock).mockResolvedValue({ data: { exists: false } });
  });

  it("shows nothing on first render and keeps the next button pressable", () => {
    render(<NewEmployeePage />);

    expect(slotOf(field("employee-name"))).toBeEmptyDOMElement();
    expect(slotOf(field("employee-phone"))).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "다음 →" })).toBeEnabled();
  });

  it("reports a cleared required name", () => {
    render(<NewEmployeePage />);

    fireEvent.change(field("employee-name"), { target: { value: "김" } });
    expect(slotOf(field("employee-name"))).toBeEmptyDOMElement();
    fireEvent.change(field("employee-name"), { target: { value: "" } });
    expect(slotOf(field("employee-name"))).toHaveTextContent("이름을 입력해 주세요");
  });

  it("hints then errors for a partial phone number", () => {
    render(<NewEmployeePage />);

    fireEvent.focus(field("employee-phone"));
    fireEvent.change(field("employee-phone"), { target: { value: "0101234" } });
    expect(slotOf(field("employee-phone"))).toHaveTextContent("010-1234-5678 형식");
    fireEvent.blur(field("employee-phone"));
    expect(slotOf(field("employee-phone"))).toHaveTextContent("010-1234-5678로 입력해 주세요");
    expect(field("employee-phone")).toHaveAttribute("aria-invalid", "true");
  });

  it("on next shows every problem, focuses the first one and stays on the step", () => {
    render(<NewEmployeePage />);

    fireEvent.click(screen.getByRole("button", { name: "다음 →" }));

    expect(slotOf(field("employee-name"))).toHaveTextContent("이름을 입력해 주세요");
    expect(slotOf(field("employee-phone"))).toHaveTextContent("연락처를 입력해 주세요");
    expect(field("employee-name")).toHaveFocus();
    expect(useEmployeeWizardStore.getState().currentStep).toBe(0);
  });

  it("shows the work-area requirement only after a failed attempt to register", () => {
    act(() => useEmployeeWizardStore.getState().setCurrentStep(1));
    render(<NewEmployeePage />);

    const slot = document.getElementById("employee-work-area-message") as HTMLElement;
    expect(slot).toHaveTextContent("0개 선택됨 · 복수 선택 가능");

    fireEvent.click(screen.getByRole("button", { name: "✓ 등록" }));
    expect(slot).toHaveTextContent("근무 지역을 선택해 주세요");
    expect(mockCreateEmployee).not.toHaveBeenCalled();
  });

  it("keeps the open-status guidance in its label-row slot with nothing below the options", () => {
    act(() => useEmployeeWizardStore.getState().setCurrentStep(1));
    render(<NewEmployeePage />);

    const slot = document.getElementById("employee-open-status-message") as HTMLElement;
    expect(slot).toHaveTextContent("고객 매칭 노출 · 언제든 변경");
    expect(slot).toHaveAttribute("aria-live", "polite");
    expect(screen.getAllByText("고객 매칭 노출 · 언제든 변경")).toHaveLength(1);
    expect(screen.queryByText(/새로운 고객 매칭에 노출될지 여부/)).not.toBeInTheDocument();
  });
});
