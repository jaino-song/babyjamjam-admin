import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import ServiceRecordPage from "../page";

// The real ApprovalTwoButtonModal (Radix) is deliberately NOT mocked here.
jest.mock("next/navigation", () => ({ useParams: () => ({ token: "test-token" }) }));

const calendarState: { ready: boolean; error: "load-failed" | null } = { ready: true, error: null };
jest.mock("@/hooks/useTokenBusinessDayCalendar", () => ({
    useTokenBusinessDayCalendar: () => ({
        calendar: { isBusinessDay: () => true, diffBusinessDays: () => 5 },
        ready: calendarState.ready,
        error: calendarState.error,
        retry: jest.fn(),
    }),
}));
jest.mock("@/components/app/service-record/ServiceRecordWizard", () => ({
    MobileServiceRecordWizard: (props: MobileServiceRecordWizardProps) => (
        <div>
            <span data-testid="screen">{props.screen}</span>
            <button onClick={() => props.onOpenDay(1)}>open day</button>
            <button onClick={() => props.onServiceDateChange("2026-07-24")}>change date</button>
            <button onClick={() => void props.onOpenScheduleChangePreview()}>open schedule preview</button>
            <span data-testid="date">{String(props.draft._date ?? "")}</span>
            {props.slots?.scheduleChangeModal}
            {props.slots?.serviceDateChangeModal}
        </div>
    ),
}));

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

const context = {
    totalSessions: 1, startDate: "2026-07-17", sessions: [], header: {},
};
const preview = { sessionIndex: 1, fromDate: "2026-07-20", toDate: "2026-07-21" };

let requests: Array<{ url: string; method: string }>;

function installFetch(extra: Responder) {
    requests = [];
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, method: init?.method ?? "GET" });
        if (url.endsWith("/link")) return Promise.resolve(jsonResponse({ valid: true }));
        if (url.endsWith("/context")) return Promise.resolve(jsonResponse(context));
        return Promise.resolve(extra(url, init));
    }) as unknown as typeof fetch;
}

function scheduleRequests(method: string) {
    return requests.filter((r) => r.url.endsWith("/schedule-change") && r.method === method);
}

describe("service-record page approval modals", () => {
    beforeEach(() => {
        calendarState.ready = true;
        calendarState.error = null;
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    async function renderOverview() {
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    }

    describe("schedule change", () => {
        it("shows the loading state, then the previewed change with a visible description", async () => {
            const previewResponse = deferredResponse();
            installFetch((url) => (url.endsWith("/schedule-change/preview")
                ? previewResponse.promise
                : jsonResponse({}, 404)));
            await renderOverview();

            fireEvent.click(screen.getByRole("button", { name: "open schedule preview" }));

            expect(await screen.findByRole("dialog")).toBeInTheDocument();
            expect(screen.getByText("서비스 일정 변경")).toBeInTheDocument();
            expect(screen.getByText("변경 가능한 일정을 확인하고 있어요.")).not.toHaveClass("sr-only");
            const loading = screen.getByRole("button", { name: "불러오는 중…" });
            expect(loading).toBeDisabled();

            previewResponse.resolve(jsonResponse(preview));

            expect(await screen.findByText("1회차 서비스 일정을 조정할까요?")).toBeInTheDocument();
            const description = screen.getByText(/본사 승인 후 일정이 조정됩니다/);
            expect(description).not.toHaveClass("sr-only");
            expect(screen.getByRole("button", { name: "승인 요청" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "취소" })).toBeEnabled();
        });

        it("closes on 취소 without sending a change request", async () => {
            const user = userEvent.setup();
            installFetch((url) => (url.endsWith("/schedule-change/preview")
                ? jsonResponse(preview)
                : jsonResponse({}, 404)));
            await renderOverview();

            await user.click(screen.getByRole("button", { name: "open schedule preview" }));
            await user.click(await screen.findByRole("button", { name: "취소" }));

            await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
            expect(scheduleRequests("POST")).toHaveLength(0);
        });

        it("sends the schedule-change request exactly once on 승인 요청", async () => {
            const user = userEvent.setup();
            installFetch((url, init) => {
                if (url.endsWith("/schedule-change/preview")) return jsonResponse(preview);
                if (url.endsWith("/schedule-change") && init?.method === "POST") return jsonResponse({});
                return jsonResponse({}, 404);
            });
            await renderOverview();

            await user.click(screen.getByRole("button", { name: "open schedule preview" }));
            await user.click(await screen.findByRole("button", { name: "승인 요청" }));

            await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
            expect(scheduleRequests("POST")).toHaveLength(1);
        });
    });

    describe("service-date change", () => {
        async function openServiceDateModal() {
            await renderOverview();
            fireEvent.click(screen.getByText("open day"));
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("day"));
            expect(screen.getByTestId("date")).toHaveTextContent("2026-07-17");
        }

        it("shows a visible description and the calendar notice", async () => {
            installFetch(() => jsonResponse({}, 404));
            await openServiceDateModal();
            calendarState.ready = false;

            fireEvent.click(screen.getByRole("button", { name: "change date" }));

            expect(await screen.findByRole("dialog")).toBeInTheDocument();
            expect(screen.getByText("1회차 제공일을 변경할까요?")).toBeInTheDocument();
            expect(screen.getByText("공휴일 정보를 확인한 뒤 제공일을 변경할 수 있어요.")).not.toHaveClass("sr-only");
            expect(screen.getByRole("status")).toHaveTextContent("공휴일 정보를 불러오는 중이에요…");
            expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();
        });

        it("reverts the date on 취소", async () => {
            const user = userEvent.setup();
            installFetch(() => jsonResponse({}, 404));
            await openServiceDateModal();

            fireEvent.click(screen.getByRole("button", { name: "change date" }));
            const description = await screen.findByText(/서비스 제공일을/);
            expect(description).not.toHaveClass("sr-only");
            await user.click(screen.getByRole("button", { name: "취소" }));

            await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
            expect(screen.getByTestId("date")).toHaveTextContent("2026-07-17");
        });

        it("applies the new date on 확인", async () => {
            const user = userEvent.setup();
            installFetch(() => jsonResponse({}, 404));
            await openServiceDateModal();

            fireEvent.click(screen.getByRole("button", { name: "change date" }));
            await user.click(await screen.findByRole("button", { name: "확인" }));

            await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
            expect(screen.getByTestId("date")).toHaveTextContent("2026-07-24");
        });
    });
});
