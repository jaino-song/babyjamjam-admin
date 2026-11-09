import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAY_PAGES } from "@babyjamjam/service-record-ui";
import { ReviewStep } from "@/components/app/service-record/screen/ReviewStep";
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
// jsdom cannot draw the canvas signature; keep the saved-signature seam.
jest.mock("@/components/app/service-record/SignaturePad", () => ({
    SignaturePad: () => <div>산모 서명</div>,
}));
jest.mock("@/components/app/service-record/ServiceRecordWizard", () => ({
    MobileServiceRecordWizard: (props: MobileServiceRecordWizardProps) => (
        <div>
            <span data-testid="screen">{props.screen}</span>
            <span data-testid="day">{props.day}</span>
            <span data-testid="open-days">{props.openDays?.().join(",")}</span>
            <button onClick={() => props.onOpenDay(props.nextOpenDay())}>다음 회차 입력</button>
            <button onClick={props.onBack}>back</button>
            <input aria-label="notes" value={String(props.draft.notes ?? "")} onChange={(e) => props.onFieldChange("notes", e.target.value)} />
            <button onClick={() => props.onOpenDay(1)}>open day 1</button>
            <button onClick={() => props.onOpenDay(2)}>open day 2</button>
            <button onClick={() => props.onOpenDay(4)}>open day 4</button>
            <button onClick={() => props.onOpenDay(5)}>open day 5</button>
            <button onClick={() => props.onOpenSubmitModal()}>open submit modal</button>
            <button onClick={() => props.onNextPage()}>save section</button>
            {props.screen === "day" && props.pageIdx === DAY_PAGES.length - 1 && <ReviewStep {...props} />}
            {props.slots?.submitModal}
            {props.slots?.errorNotification}
            <span data-testid="editing">{String(props.editing)}</span>
            <span data-testid="page-idx">{props.pageIdx}</span>
        </div>
    ),
}));

function jsonResponse(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

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

    it("keeps the restored input page for another caregiver's submitted day", async () => {
        installFetch(99);
        await restoreInputPageViaPopstate();

        expect(screen.getByTestId("page-idx")).toHaveTextContent("0");
        expect(screen.getByTestId("editing")).toHaveTextContent("true");
    });

    it("keeps the restored input page for a submitted day with no recorded caregiver", async () => {
        installFetch(null);
        await restoreInputPageViaPopstate();

        expect(screen.getByTestId("page-idx")).toHaveTextContent("0");
    });

    it("keeps the restored input page for the caregiver's own submitted day", async () => {
        installFetch(7);
        await restoreInputPageViaPopstate();

        expect(screen.getByTestId("page-idx")).toHaveTextContent("0");
        expect(screen.getByTestId("editing")).toHaveTextContent("true");
    });
});

describe("service-record page every gap plus next session guards", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    async function renderOverview(submittedDays: number[], submitStatus = 200) {
        const context = {
            totalSessions: 5,
            startDate: "2026-07-17",
            header: { name: "x" },
            employee: { id: 7, name: "김돌봄" },
            sessions: submittedDays.map((sessionIndex) => ({
                sessionIndex,
                locked: true,
                serviceDate: `2026-07-${16 + sessionIndex}`,
                answers: {},
                etcService: "",
                notes: "",
                paymentConfirmed: true,
                clientSignature: "signed",
                employeeId: 7,
            })),
        };
        global.fetch = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith("/link")) return Promise.resolve(jsonResponse({ valid: true }));
            if (url.endsWith("/context")) return Promise.resolve(jsonResponse(context));
            if (url.endsWith("/submit")) return Promise.resolve(jsonResponse(submitStatus === 200 ? {} : { code: "REQUEST_CONFLICT" }, submitStatus));
            return Promise.resolve(jsonResponse({}, 404));
        }) as unknown as typeof fetch;

        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent(submittedDays.length === 5 ? "done" : "overview"));
    }

    it("refuses popstate to day 5 after day 1 was deleted", async () => {
        await renderOverview([2, 3]);

        window.history.pushState(null, "", "/service-record/test-token?step=day&day=5&page=0");
        act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });

        expect(screen.getByTestId("screen")).toHaveTextContent("overview");
        expect(window.location.search).toBe("?step=overview");
    });

    it.each([
        { submittedDays: [2, 3], targetDay: 1 },
        { submittedDays: [2, 3], targetDay: 4 },
        { submittedDays: [3], targetDay: 2 },
        { submittedDays: [1, 2, 3], targetDay: 4 },
    ])("restores day $targetDay via popstate with submitted sessions $submittedDays", async ({ submittedDays, targetDay }) => {
        await renderOverview(submittedDays);

        window.history.pushState(null, "", `/service-record/test-token?step=day&day=${targetDay}&page=0`);
        act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });

        expect(screen.getByTestId("screen")).toHaveTextContent("day");
        expect(screen.getByTestId("day")).toHaveTextContent(String(targetDay));
        expect(screen.getByTestId("editing")).toHaveTextContent("false");
    });

    it("refuses onOpenDay for day 5 after day 1 was deleted", async () => {
        const user = userEvent.setup();
        await renderOverview([2, 3]);
        const overviewSearch = window.location.search;

        await user.click(screen.getByRole("button", { name: "open day 5" }));

        expect(screen.getByTestId("screen")).toHaveTextContent("overview");
        expect(window.location.search).toBe(overviewSearch);
        expect(window.location.search).not.toContain("step=day");
    });

    it.each([
        { submittedDays: [2, 3], targetDay: 1 },
        { submittedDays: [2, 3], targetDay: 4 },
        { submittedDays: [3], targetDay: 2 },
        { submittedDays: [1, 2, 3], targetDay: 4 },
    ])("opens day $targetDay via onOpenDay with submitted sessions $submittedDays", async ({ submittedDays, targetDay }) => {
        const user = userEvent.setup();
        await renderOverview(submittedDays);

        await user.click(screen.getByRole("button", { name: `open day ${targetDay}` }));

        expect(screen.getByTestId("screen")).toHaveTextContent("day");
        expect(screen.getByTestId("day")).toHaveTextContent(String(targetDay));
        expect(screen.getByTestId("editing")).toHaveTextContent("false");
    });
    it.each([
        { submitted: [2, 3], open: "1,4" },
        { submitted: [3], open: "1,2,4" },
        { submitted: [1, 2, 3], open: "4" },
        { submitted: [], open: "1" },
        { submitted: [1, 2, 3, 4, 5], open: "" },
    ])("passes open days $open for submitted $submitted", async ({ submitted, open }) => {
        await renderOverview(submitted);
        expect(screen.getByTestId("open-days").textContent).toBe(open);
    });

    it("keeps the primary next-session action on the earliest gap", async () => {
        await renderOverview([2, 3]);
        await userEvent.setup().click(screen.getByRole("button", { name: "다음 회차 입력" }));
        expect(screen.getByTestId("screen")).toHaveTextContent("day");
        expect(screen.getByTestId("day")).toHaveTextContent("1");
    });

    it("restores page zero of session 4 after saving its first section", async () => {
        const user = userEvent.setup();
        await renderOverview([2, 3]);
        await user.click(screen.getByRole("button", { name: "open day 4" }));
        await user.click(screen.getByRole("button", { name: "save section" }));
        expect(screen.getByTestId("page-idx")).toHaveTextContent("1");
        window.history.pushState(null, "", "/service-record/test-token?step=day&day=4&page=0");
        act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
        expect(screen.getByTestId("screen")).toHaveTextContent("day");
        expect(screen.getByTestId("day")).toHaveTextContent("4");
        expect(screen.getByTestId("page-idx")).toHaveTextContent("0");
    });

    it("keeps independent typed drafts when moving between open sessions", async () => {
        const user = userEvent.setup();
        await renderOverview([2, 3]);
        const back = async () => {
            await user.click(screen.getByRole("button", { name: "back" }));
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
        };
        await user.click(screen.getByRole("button", { name: "open day 1" }));
        await user.type(screen.getByRole("textbox", { name: "notes" }), "first draft");
        await back();
        await user.click(screen.getByRole("button", { name: "open day 4" }));
        await user.type(screen.getByRole("textbox", { name: "notes" }), "fourth draft");
        await back();
        await user.click(screen.getByRole("button", { name: "open day 1" }));
        expect(screen.getByRole("textbox", { name: "notes" })).toHaveValue("first draft");
        await back();
        await user.click(screen.getByRole("button", { name: "open day 4" }));
        expect(screen.getByRole("textbox", { name: "notes" })).toHaveValue("fourth draft");
    });

    it("migrates a legacy draft for its own day while another day is opened first", async () => {
        window.sessionStorage.setItem("daily-service-record-draft:test-token", JSON.stringify({
            day: 1, pageIdx: 1, draft: { notes: "legacy first" },
        }));
        await renderOverview([2, 3]);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "open day 4" }));
        await user.type(screen.getByRole("textbox", { name: "notes" }), "new fourth");
        await user.click(screen.getByRole("button", { name: "open day 1" }));
        expect(screen.getByRole("textbox", { name: "notes" })).toHaveValue("legacy first");
        expect(screen.getByTestId("page-idx")).toHaveTextContent("1");
        const stored = JSON.parse(window.sessionStorage.getItem("daily-service-record-draft:test-token") ?? "null");
        expect(stored.day).toBeUndefined();
        expect(stored.drafts[4].draft.notes).toBe("new fourth");
    });

    it.each([200, 409])("preserves other drafts and clears the submitted draft only on success (status=%s)", async (status) => {
        const storageKey = "daily-service-record-draft:test-token";
        window.sessionStorage.setItem(storageKey, JSON.stringify({
            drafts: {
                1: { pageIdx: 0, draft: { notes: "first draft" } },
                4: { pageIdx: 2, draft: { notes: "fourth draft" } },
            },
        }));
        await renderOverview([2, 3], status);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "open day 1" }));
        await user.click(screen.getByRole("button", { name: "open submit modal" }));
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "확인" }));
        if (status === 200) {
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
        } else {
            await screen.findByText("이미 처리되었거나 수정할 수 없는 상태예요.");
        }
        const stored = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null");
        expect(stored.drafts[4]).toEqual({ pageIdx: 2, draft: { notes: "fourth draft" } });
        if (status === 200) expect(stored.drafts[1]).toBeUndefined();
        else expect(stored.drafts[1].draft.notes).toBe("first draft");
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

    it("closes the submit dialog when Back changes the day without submitting", async () => {
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

    it("offers section edits and posts another caregiver's submitted day", async () => {
        const fetchMock = installTwoDayFetch(99);
        const user = userEvent.setup();
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));

        await user.click(screen.getByRole("button", { name: "open day 1" }));
        expect(screen.getAllByRole("button", { name: /수정$/ })).toHaveLength(4);
        expect(screen.queryByText(/다른 제공인력이\s제출한 회차라 수정할 수 없어요\./)).toBeNull();
        expect(screen.getByRole("button", { name: "확인" })).toBeEnabled();

        await user.click(screen.getByRole("button", { name: "산모 수정" }));
        expect(screen.getByTestId("page-idx")).toHaveTextContent("0");
        await user.click(screen.getByRole("button", { name: "save section" }));
        await user.click(screen.getByRole("button", { name: "확인" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "확인" }));

        await waitFor(() => expect(submitCalls(fetchMock)).toHaveLength(1));
        const [url, init] = submitCalls(fetchMock)[0];
        expect(String(url)).toContain("/sessions/1/submit");
        expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ serviceDate: "2026-07-17" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("still posts the caregiver's own submitted day", async () => {
        const fetchMock = installTwoDayFetch(99);
        const user = userEvent.setup();
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));

        await user.click(screen.getByRole("button", { name: "open day 2" }));
        await user.click(screen.getByRole("button", { name: "open submit modal" }));
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "확인" }));

        await waitFor(() => expect(submitCalls(fetchMock)).toHaveLength(1));
    });
});
