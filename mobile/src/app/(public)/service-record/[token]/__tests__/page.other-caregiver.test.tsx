import { act, render, screen, waitFor } from "@testing-library/react";
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
