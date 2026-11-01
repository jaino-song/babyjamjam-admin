import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createProblemDetails } from "@babyjamjam/shared";

import { api } from "@/lib/api/client";
import { EmployeeFormDialog } from "../EmployeeFormDialog";

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

const detail = "삭제된 관리사가 이 전화번호를 사용했어요. 그분을 복원하거나 새 관리사로 등록해 주세요.";
const conflict = (deletedEmployee: unknown = { id: 42, name: "이전관리" }) => ({
  response: { status: 409, data: { code: "EMPLOYEE_PHONE_HELD_BY_DELETED", detail, deletedEmployee } },
});

describe("employee deleted phone choice (real mutation)", () => {
  let client: QueryClient;
  const onClose = jest.fn();
  const onSuccess = jest.fn();

  beforeAll(() => {
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });
  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    jest.mocked(api.get).mockResolvedValue({ data: { exists: false } });
    jest.mocked(api.post).mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { client.clear(); jest.restoreAllMocks(); });

  async function submit(failure?: unknown) {
    if (failure) jest.mocked(api.post).mockRejectedValueOnce(failure);
    else jest.mocked(api.post).mockResolvedValueOnce({ data: { id: 42, name: "김관리", restored: true } });
    render(<QueryClientProvider client={client}><EmployeeFormDialog open onClose={onClose} onSuccess={onSuccess} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue(""));
    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "김관리" } });
    fireEvent.click(screen.getByRole("combobox", { name: /근무 지역 선택/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "남동구" }));
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
    await screen.findByText("등록 가능한 번호입니다.");
    const button = document.querySelector<HTMLButtonElement>('[data-component="desktop_employees_form-dialog_submit"]')!;
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  }

  it("opens a choice with the deleted name from the HTTP body, not a plain error", async () => {
    await submit(conflict());
    expect(await screen.findByRole("button", { name: "이전관리님 복원" })).toBeVisible();
    expect(screen.getByRole("button", { name: "새 관리사로 등록" })).toBeVisible();
    expect(screen.getByRole("button", { name: "새 관리사로 등록" })).toHaveAttribute("data-width", "lg");
    expect(screen.getByRole("button", { name: "새 관리사로 등록" })).toHaveClass("w-full");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["이전관리님 복원", "restore", true],
    ["새 관리사로 등록", "register_new", false],
  ])("%s resubmits the original fields with %s and closes on success", async (label, option, restored) => {
    await submit(conflict());
    const action = await screen.findByRole("button", { name: label });
    const original = jest.mocked(api.post).mock.calls[0][1];
    expect(original).not.toHaveProperty("onDeletedPhoneMatch");
    jest.mocked(api.post).mockResolvedValueOnce({ data: { id: restored ? 42 : 43, restored } });
    fireEvent.click(action);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenLastCalledWith("/employees", { ...original as object, onDeletedPhoneMatch: option });
    expect(screen.queryByRole("button", { name: "이전관리님 복원" })).not.toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith({ id: restored ? 42 : 43, restored });
    expect(mockToast).toHaveBeenCalledTimes(restored ? 1 : 0);
  });

  it("cancel preserves the form and makes no further request", async () => {
    await submit(conflict());
    await screen.findByRole("button", { name: "이전관리님 복원" });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "이전관리님 복원" })).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/이름/)).toHaveValue("김관리");
    expect(screen.getByLabelText(/연락처/)).toHaveValue("010-1234-5678");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to the catalog detail when the extension is missing", async () => {
    await submit(conflict(null));
    expect(await screen.findByText(detail)).toBeVisible();
    expect(screen.getByRole("button", { name: "삭제된 관리사 복원" })).toBeVisible();
  });

  it("renders an untrusted name as plain text", async () => {
    await submit(conflict({ id: 42, name: "<img src=x onerror=alert(1)>" }));
    expect(await screen.findByRole("button", { name: "<img src=x onerror=alert(1)>님 복원" })).toBeVisible();
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps any other 409 as a plain error", async () => {
    await submit({ response: { status: 409, data: createProblemDetails({ code: "EMPLOYEE_PHONE_ALREADY_REGISTERED", status: 409, requestId: "req-duplicate" }) } });
    expect(await screen.findByText("같은 전화번호의 관리사가 이미 등록되어 있어요.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "새 관리사로 등록" })).not.toBeInTheDocument();
  });

  it("same-name automatic restore keeps its toast without opening a choice", async () => {
    await submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({ title: "삭제된 관리사를 복원했습니다", variant: "success" });
    expect(screen.queryByRole("button", { name: "새 관리사로 등록" })).not.toBeInTheDocument();
  });
});
