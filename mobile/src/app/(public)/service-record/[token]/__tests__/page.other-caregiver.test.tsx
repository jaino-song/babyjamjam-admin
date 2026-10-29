import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAY_PAGES } from "@babyjamjam/service-record-ui";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import ServiceRecordPage from "../page";

jest.mock("next/navigation", () => ({ useParams: () => ({ token: "test-token" }) }));

jest.mock("@/hooks/useTokenBusinessDayCalendar", () => ({
    useTokenBusinessDayCalendar: () => ({
        calendar: { isBusinessDay: () => true, diffBusinessDays: () => 5 },
        ready: true,
        error: null,
        retry: jest.fn(),
    }),
}));
jest.mock("@/components/app/service-record/ServiceRecordWizard", () => ({
    MobileServiceRecordWizard: (props: MobileServiceRecordWizardProps) => (
        <div>
            <span data-testid="screen">{props.screen}</span>
            <span data-testid="day">{props.day}</span>
            <button onClick={() => props.onOpenDay(1)}>open day 1</button>
            <button onClick={() => props.onOpenDay(2)}>open day 2</button>
            <button onClick={() => props.onOpenSubmitModal()}>open submit modal</button>
            {props.slots?.submitModal}
            <span data-testid="editing">{String(props.editing)}</span>
            <span data-testid="page-idx">{props.pageIdx}</span>
        </div>
    ),
}));

function jsonResponse(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const REVIEW_PAGE_IDX = DAY_PAGES.length - 1;

function installFetch(sessionEmployeeId: number | null | undefined) {
    const context = {
        totalSessions: 2,
        startDate: "2026-07-17",
        header: { name: "x" },
        employee: { id: 7, name: "김돌봄" },
        sessions: [{
            sessionIndex: 1,
            locked: true,
            serviceDate: "2026-07-17",
            answers: {},
            etcService: "",
            notes: "",
            paymentConfirmed: true,
            clientSignature: "signed",
            ...(sessionEmployeeId === undefined ? {} : { employeeId: sessionEmployeeId }),
        }],
    };
    global.fetch = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/link")) return Promise.resolve(jsonResponse({ valid: true }));
        if (url.endsWith("/context")) return Promise.resolve(jsonResponse(context));
        return Promise.resolve(jsonResponse({}, 404));
    }) as unknown as typeof fetch;
}

async function restoreInputPageViaPopstate() {
    render(<ServiceRecordPage />);
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
    window.history.pushState(null, "", "/service-record/test-token?step=day&day=1&page=0");
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("day"));
}

describe("service-record page popstate restore of a submitted day", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    it("clamps another caregiver's submitted day to the review page", async () => {
        installFetch(99);
        await restoreInputPageViaPopstate();

        expect(screen.getByTestId("page-idx")).toHaveTextContent(String(REVIEW_PAGE_IDX));
        expect(screen.getByTestId("editing")).toHaveTextContent("true");
    });

    it("clamps a submitted day with no recorded caregiver to the review page", async () => {
        installFetch(null);
        await restoreInputPageViaPopstate();

        expect(screen.getByTestId("page-idx")).toHaveTextContent(String(REVIEW_PAGE_IDX));
    });

    it("keeps the restored input page for the caregiver's own submitted day", async () => {
        installFetch(7);
        await restoreInputPageViaPopstate();

        expect(screen.getByTestId("page-idx")).toHaveTextContent("0");
        expect(screen.getByTestId("editing")).toHaveTextContent("true");
    });
});

describe("service-record page submit dialog across a caregiver change", () => {
    const row = (sessionIndex: number, employeeId: number | null) => ({
        sessionIndex,
        locked: true,
        serviceDate: `2026-07-${16 + sessionIndex}`,
        answers: {},
        etcService: "",
        notes: "",
        paymentConfirmed: true,
        clientSignature: "signed",
        employeeId,
    });

    function installTwoDayFetch(day1EmployeeId: number | null) {
        const context = {
            totalSessions: 3,
            startDate: "2026-07-17",
            header: { name: "x" },
            employee: { id: 7, name: "김돌봄" },
            sessions: [row(1, day1EmployeeId), row(2, 7)],
        };
        const fetchMock = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith("/link")) return Promise.resolve(jsonResponse({ valid: true }));
            if (url.endsWith("/context")) return Promise.resolve(jsonResponse(context));
            return Promise.resolve(jsonResponse({}, 200));
        });
        global.fetch = fetchMock as unknown as typeof fetch;
        return fetchMock;
    }

    const submitCalls = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter(([input, init]) => (
        String(input).includes("/submit") && (init as RequestInit | undefined)?.method === "POST"
    ));

    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    it("closes the submit dialog when Back lands on another caregiver's day, and sends nothing", async () => {
        const fetchMock = installTwoDayFetch(99);
        const user = userEvent.setup();
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));

        await user.click(screen.getByRole("button", { name: "open day 2" }));
        await user.click(screen.getByRole("button", { name: "open submit modal" }));
        expect(await screen.findByRole("dialog")).toBeInTheDocument();

        window.history.pushState(null, "", "/service-record/test-token?step=day&day=1&page=0");
        act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });

        await waitFor(() => expect(screen.getByTestId("day")).toHaveTextContent("1"));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(submitCalls(fetchMock)).toHaveLength(0);
    });

    it("never posts another caregiver's day even when the dialog is confirmed on it", async () => {
        const fetchMock = installTwoDayFetch(99);
        const user = userEvent.setup();
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));

        await user.click(screen.getByRole("button", { name: "open day 1" }));
        await user.click(screen.getByRole("button", { name: "open submit modal" }));
        await user.click(await screen.findByRole("button", { name: "확인" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(submitCalls(fetchMock)).toHaveLength(0);
    });

    it("still posts the caregiver's own submitted day", async () => {
        const fetchMock = installTwoDayFetch(99);
        const user = userEvent.setup();
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));

        await user.click(screen.getByRole("button", { name: "open day 2" }));
        await user.click(screen.getByRole("button", { name: "open submit modal" }));
        await user.click(await screen.findByRole("button", { name: "확인" }));

        await waitFor(() => expect(submitCalls(fetchMock)).toHaveLength(1));
    });
});
