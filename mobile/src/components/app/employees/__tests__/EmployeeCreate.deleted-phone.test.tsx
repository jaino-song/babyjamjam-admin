import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createProblemDetails } from "@babyjamjam/shared";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";
import NewEmployeePage from "@/app/(shell)/employees/new/page";
import { EmployeeFormDialog } from "../EmployeeFormDialog";

const mockToast = jest.fn();
const mockPush = jest.fn();
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
// Keep the form, choice modal and mutations real; only replace the animated outer sheet.
jest.mock("@/components/app/mobile-redesign/mobile-detail-slideup", () => ({
  MobileDetailSlideUp: ({ children, primaryAction }: {
    children: ReactNode; primaryAction: { label: string; onClick: () => void; disabled: boolean };
  }) => <div>{children}<button onClick={primaryAction.onClick} disabled={primaryAction.disabled}>{primaryAction.label}</button></div>,
}));

const detail = "삭제된 관리사가 이 전화번호를 사용했어요. 그분을 복원하거나 새 관리사로 등록해 주세요.";
const conflict = (deletedEmployee: unknown = { id: 42, name: "이전관리" }) => ({
  response: { status: 409, data: { code: "EMPLOYEE_PHONE_HELD_BY_DELETED", detail, deletedEmployee } },
});

describe.each(["wizard", "dialog"] as const)("mobile %s deleted phone choice (real mutation)", (surface) => {
  let client: QueryClient;
  const onClose = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => useEmployeeWizardStore.getState().reset());
    client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    jest.mocked(api.get).mockResolvedValue({ data: { exists: false } });
    jest.mocked(api.post).mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { client.clear(); jest.restoreAllMocks(); });

  async function submit(failure?: unknown) {
    if (failure) jest.mocked(api.post).mockRejectedValueOnce(failure);
    else jest.mocked(api.post).mockResolvedValueOnce({ data: { id: 42, restored: true } });
    render(<QueryClientProvider client={client}>{surface === "wizard" ? <NewEmployeePage /> : <EmployeeFormDialog open onClose={onClose} />}</QueryClientProvider>);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "김관리" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
    await screen.findByText(/등록 가능한 번호입니다/);
    if (surface === "wizard") fireEvent.click(screen.getByRole("button", { name: "다음 →" }));
    fireEvent.click(screen.getByRole("button", { name: "남동구" }));
    const button = screen.getByRole("button", { name: surface === "wizard" ? "✓ 등록" : "등록" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  }

  async function expectClosed() {
    await waitFor(() => {
      if (surface === "wizard") expect(mockPush).toHaveBeenCalled();
      else expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("button", { name: "이전관리님 복원" })).not.toBeInTheDocument();
  }

  it("opens a choice using the deleted name in the HTTP body, not a plain error", async () => {
    await submit(conflict());
    expect(await screen.findByRole("button", { name: "이전관리님 복원" })).toBeVisible();
    expect(screen.getByRole("button", { name: "새 관리사로 등록" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["이전관리님 복원", "restore", true],
    ["새 관리사로 등록", "register_new", false],
  ])("%s resubmits with %s and closes on success", async (label, option, restored) => {
    await submit(conflict());
    const action = await screen.findByRole("button", { name: label });
    const original = jest.mocked(api.post).mock.calls[0][1];
    expect(original).not.toHaveProperty("onDeletedPhoneMatch");
    jest.mocked(api.post).mockResolvedValueOnce({ data: { id: restored ? 42 : 43, restored } });
    fireEvent.click(action);
    await expectClosed();
    expect(api.post).toHaveBeenLastCalledWith("/employees", { ...original as object, onDeletedPhoneMatch: option });
    expect(mockToast).toHaveBeenCalledTimes(restored ? 1 : 0);
    if (surface === "wizard") expect(mockPush).toHaveBeenCalledWith(`/employees?id=${restored ? 42 : 43}`);
  });

  it("cancel preserves the form and sends nothing else", async () => {
    await submit(conflict());
    await screen.findByRole("button", { name: "이전관리님 복원" });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "이전관리님 복원" })).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/이름/)).toHaveValue("김관리");
    expect(screen.getByLabelText(/연락처/)).toHaveValue("010-1234-5678");
    expect(mockPush).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to the catalog detail without the extension", async () => {
    await submit(conflict(null));
    expect(await screen.findByText(detail)).toBeVisible();
    expect(screen.getByRole("button", { name: "삭제된 관리사 복원" })).toBeVisible();
  });

  it("renders the deleted name as plain text", async () => {
    await submit(conflict({ id: 42, name: "<img src=x onerror=alert(1)>" }));
    expect(await screen.findByRole("button", { name: "<img src=x onerror=alert(1)>님 복원" })).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps another 409 as a plain error", async () => {
    await submit({ response: { status: 409, data: createProblemDetails({ code: "EMPLOYEE_PHONE_ALREADY_REGISTERED", status: 409, requestId: "req-duplicate" }) } });
    expect(await screen.findByText("같은 전화번호의 관리사가 이미 등록되어 있어요.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "새 관리사로 등록" })).not.toBeInTheDocument();
  });

  it("same-name automatic restore shows its toast with no choice", async () => {
    await submit();
    await expectClosed();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({ title: "삭제된 관리사를 복원했습니다", variant: "success" });
    expect(screen.queryByRole("button", { name: "새 관리사로 등록" })).not.toBeInTheDocument();
  });
});
