import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import { toast } from "@/hooks/use-toast";
import ServiceRecordPage from "../page";

jest.mock("next/navigation", () => ({ useParams: () => ({ token: "test-token" }) }));
jest.mock("@/hooks/use-toast", () => ({ toast: jest.fn() }));
jest.mock("@/hooks/useTokenBusinessDayCalendar", () => ({
    useTokenBusinessDayCalendar: () => ({ calendar: { isBusinessDay: () => true }, ready: true, error: null, retry: jest.fn() }),
}));
jest.mock("@/components/app/service-record/ServiceRecordWizard", () => ({
    MobileServiceRecordWizard: (props: MobileServiceRecordWizardProps) => <div>
        <span data-testid="screen">{props.screen}</span>
        <span data-testid="date-error">{props.serviceDateError}</span>
        <button onClick={() => props.onOpenDay(1, true)}>edit 1</button>
        <button onClick={props.onOpenDateSheet}>date</button>
        <button onClick={props.onDeleteSession}>delete</button>
        <button onClick={props.onOpenSubmitModal}>submit</button>
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

it("cancel leaves the record and DELETE untouched; confirm deletes then reloads and toasts", async () => {
    await openEdit();
    fireEvent.click(screen.getByText("delete"));
    expect(screen.getByText("기록과 고객 서명이 모두 삭제됩니다.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(mockFetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByText("delete"));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    expect(mockFetch).toHaveBeenCalledWith("/api/service-record/test-token/sessions/1", expect.objectContaining({ method: "DELETE" }));
    expect(toast).toHaveBeenCalledWith({ variant: "success", title: "1회차 기록을 삭제했어요" });
});

it("shows a 400 date detail as a field error and closes the submit dialog", async () => {
    submitResponse = json({ code: "VALIDATION_FAILED", detail: "뒷 회차보다 늦게 바꿀 수 없어요. 뒷 회차를 먼저 변경해 주세요.", errors: [{ pointer: "/serviceDate" }] }, 400);
    await openEdit();
    fireEvent.click(screen.getByText("submit"));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(screen.getByTestId("date-error")).toHaveTextContent("뒷 회차보다 늦게 바꿀 수 없어요."));
    expect(screen.queryByRole("dialog")).toBeNull();
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
