import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import { ReviewStep } from "@/components/app/service-record/screen/ReviewStep";
import { toast } from "@/hooks/use-toast";
import { captureServiceRecordResponseError } from "@/lib/observability/capture-service-record-error";
import ServiceRecordPage from "../page";

jest.mock("next/navigation", () => ({ useParams: () => ({ token: "test-token" }) }));
jest.mock("@/hooks/use-toast", () => ({ toast: jest.fn() }));
jest.mock("@/lib/observability/capture-service-record-error", () => ({
    ...jest.requireActual("@/lib/observability/capture-service-record-error"),
    captureServiceRecordError: jest.fn(),
    captureServiceRecordResponseError: jest.fn(),
}));
jest.mock("@/components/app/service-record/SignaturePad", () => ({ SignaturePad: () => null }));
jest.mock("@/hooks/useTokenBusinessDayCalendar", () => ({
    useTokenBusinessDayCalendar: () => ({ calendar: { isBusinessDay: () => true }, ready: true, error: null, retry: jest.fn() }),
}));
jest.mock("@/components/app/service-record/ServiceRecordWizard", () => ({
    MobileServiceRecordWizard: (props: MobileServiceRecordWizardProps) => <div>
        <span data-testid="screen">{props.screen}</span>
        <span data-testid="page-index">{props.pageIdx}</span>
        <span data-testid="date-error">{props.serviceDateError}</span>
        <button onClick={() => props.onOpenDay(1, true)}>edit 1</button>
        <button onClick={() => props.onOpenDay(3, true)}>edit 3</button>
        <button onClick={() => props.onOpenDay(2)}>new 2</button>
        <button onClick={props.onNextPage}>next</button>
        <button onClick={props.onOpenDateSheet}>date</button>
        <button onClick={props.onDeleteSession}>delete</button>
        <button onClick={props.onOpenSubmitModal}>submit</button>
        {props.screen === "day" && props.editing && <ReviewStep {...props} />}
        {props.slots?.serviceDateSheet}{props.slots?.deleteModal}{props.slots?.submitModal}{props.slots?.errorNotification}
    </div>,
}));
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response;
const original = { sessionIndex: 1, serviceDate: "2026-11-02", locked: true, clientSignature: "saved" };
const mockFetch = jest.fn();
let sessions = [original];
let submitResponse: Response;
let deleteResponse: Response;

beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/service-record/test-token");
    sessions = [original];
    submitResponse = json({});
    deleteResponse = json({ deleted: true, sessionIndex: 1 });
    mockFetch.mockImplementation(async (input: string, init?: RequestInit) => {
        if (input.endsWith("/link")) return json({ valid: true });
        if (input.endsWith("/context")) return json({ totalSessions: 3, startDate: "2026-11-02", endDate: "2026-11-17", header: {}, sessions });
        if (input.endsWith("/submit")) return submitResponse;
        if (init?.method === "DELETE") { if (deleteResponse.ok) sessions = []; return deleteResponse; }
        return json({}, 404);
    });
    global.fetch = mockFetch;
});
async function openEdit() {
    render(<ServiceRecordPage />);
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    fireEvent.click(screen.getByText("edit 1"));
    expect(screen.getByTestId("screen")).toHaveTextContent("day");
}

it("resubmits the newly picked date rather than the stored date", async () => {
    await openEdit();
    fireEvent.click(screen.getByText("date"));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "2026.11.05(목)" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "선택" }));
    fireEvent.click(screen.getByText("submit"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(mockFetch.mock.calls.some(([url]) => url.endsWith("/submit"))).toBe(true));
    const [, init] = mockFetch.mock.calls.find(([url]) => url.endsWith("/submit"))!;
    expect(JSON.parse(init.body).serviceDate).toBe("2026-11-05");
});

it("reopens with the unsaved date selected and clears the review change by returning to 지금", async () => {
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "서비스 제공일 수정" }));
    fireEvent.click(screen.getByRole("button", { name: "2026.11.05(목)" }));
    fireEvent.click(screen.getByRole("button", { name: "선택" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const reviewDate = screen.getByRole("group", { name: "서비스 제공일" });
    expect(reviewDate.querySelector("del")).toHaveTextContent("11.02");
    expect(reviewDate).toHaveTextContent("2026.11.05(목)");

    fireEvent.click(screen.getByRole("button", { name: "서비스 제공일 수정" }));
    expect(screen.getByRole("button", { name: "2026.11.05(목)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "2026.11.02(월) 지금" }));
    fireEvent.click(screen.getByRole("button", { name: "선택" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reviewDate.querySelector("del")).toBeNull();
    expect(reviewDate).toHaveTextContent("2026.11.02(월)");
    expect(mockFetch.mock.calls.some(([url]) => url.endsWith("/submit"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "서비스 제공일 수정" }));
    const current = screen.getByRole("button", { name: "2026.11.02(월) 지금" });
    expect(current).toHaveAttribute("aria-disabled", "true");
    expect(current).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
});

it("cancel leaves the record and DELETE untouched; confirm deletes then reloads and toasts", async () => {
    await openEdit();
    fireEvent.click(screen.getByText("delete"));
    expect(screen.getByText("기록과 고객 서명이 모두 삭제됩니다.")).toBeVisible();
    expect(screen.getByText("기록과 고객 서명이 모두 삭제됩니다.")).not.toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "삭제" })).toHaveAttribute("data-variant", "destructive");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(mockFetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByText("delete"));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    expect(mockFetch).toHaveBeenCalledWith("/api/service-record/test-token/sessions/1", expect.objectContaining({ method: "DELETE" }));
    expect(toast).toHaveBeenCalledWith({ variant: "success", title: "1회차 기록을 삭제했어요" });
});

it("captures a failed DELETE as a delete-session response error", async () => {
    deleteResponse = json({}, 500);
    await openEdit();
    fireEvent.click(screen.getByText("delete"));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(captureServiceRecordResponseError).toHaveBeenCalledWith(
        expect.objectContaining({ status: 500 }),
        expect.objectContaining({ operation: "delete-session", method: "DELETE" }),
    ));
});

it.each([1, 3])("deleting day %s clears only that day's stored draft", async (deletedDay) => {
    const storageKey = "daily-service-record-draft:test-token";
    const storedDraft = JSON.stringify({ day: 3, draft: { notes: "typed but unsaved" } });
    window.sessionStorage.setItem(storageKey, storedDraft);
    sessions = [{ ...original, sessionIndex: deletedDay }];
    deleteResponse = json({ deleted: true, sessionIndex: deletedDay });
    render(<ServiceRecordPage />);
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    fireEvent.click(screen.getByText(`edit ${deletedDay}`));
    fireEvent.click(screen.getByText("delete"));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    expect(mockFetch).toHaveBeenCalledWith(`/api/service-record/test-token/sessions/${deletedDay}`, expect.objectContaining({ method: "DELETE" }));
    expect(window.sessionStorage.getItem(storageKey)).toBe(deletedDay === 3 ? null : storedDraft);
});

it.each<[string | undefined, string]>([
    ["OUT_OF_RANGE", "고를 수 있는 기간이 아니에요."],
    ["NOT_SERVICE_DAY", "서비스를 하지 않는 날이에요."],
    ["TAKEN", "다른 회차가 이미 고른 날이에요."],
    ["BEFORE_PREVIOUS", "앞 회차보다 이르게 바꿀 수 없어요. 앞 회차를 먼저 변경해 주세요."],
    ["AFTER_NEXT", "뒷 회차보다 늦게 바꿀 수 없어요. 뒷 회차를 먼저 변경해 주세요."],
    [undefined, "고를 수 있는 날이 아니에요. 다른 날을 골라 주세요."],
    ["UNKNOWN", "고를 수 있는 날이 아니에요. 다른 날을 골라 주세요."],
])("shows the %s date refusal reason as a field error and closes the submit dialog", async (serviceDateReason, message) => {
    submitResponse = json({ code: "VALIDATION_FAILED", detail: "입력 내용을 확인해 주세요.", errors: [{ pointer: "/serviceDate" }], serviceDateReason }, 400);
    await openEdit();
    fireEvent.click(screen.getByText("submit"));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(screen.getByTestId("date-error")).toHaveTextContent(message));
    expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows a notes validation error in the notification without a date error or navigation", async () => {
    submitResponse = json({ code: "VALIDATION_FAILED", detail: "입력 내용을 확인해 주세요.", errors: [{ pointer: "/notes" }] }, 400);
    render(<ServiceRecordPage />);
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    fireEvent.click(screen.getByText("new 2"));
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("page-index")).toHaveTextContent("1");
    const historyState = window.history.state;
    fireEvent.click(screen.getByText("submit"));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    const notification = await screen.findByRole("dialog", { name: "요청을 완료하지 못했습니다." });
    expect(within(notification).getByText("제출에 실패했어요.")).toBeVisible();
    expect(screen.getByTestId("date-error")).toBeEmptyDOMElement();
    expect(screen.getByTestId("screen")).toHaveTextContent("day");
    expect(screen.getByTestId("page-index")).toHaveTextContent("1");
    expect(window.history.state).toEqual(historyState);
});

it("returns a refused DELETE to phone verification and closes the modal", async () => {
    deleteResponse = json({ code: "AUTH_REQUIRED" }, 401);
    await openEdit();
    fireEvent.click(screen.getByText("delete"));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("phone"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast).not.toHaveBeenCalled();
});


it("uses a destructive toast when the date sheet rejects an order-blocked day", async () => {
    sessions = [original, { ...original, sessionIndex: 2, serviceDate: "2026-11-04" }];
    await openEdit();
    fireEvent.click(screen.getByText("date"));
    fireEvent.click(screen.getByRole("button", { name: "2026.11.05(목)" }));
    expect(toast).toHaveBeenCalledWith({ variant: "destructive", title: "뒷 회차보다 늦게 바꿀 수 없어요. 뒷 회차를 먼저 변경해 주세요." });
    expect(screen.getByRole("button", { name: "선택" })).toBeDisabled();
});
