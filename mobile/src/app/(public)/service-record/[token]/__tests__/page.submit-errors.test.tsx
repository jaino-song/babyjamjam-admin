import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import ServiceRecordPage from "../page";

// The real ApprovalTwoButtonModal / NotificationOneButtonModal (Radix) are deliberately NOT mocked here.
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
            <button onClick={() => props.onOpenSubmitModal()}>open submit modal</button>
            {props.slots?.submitModal}
            {props.slots?.errorNotification}
        </div>
    ),
}));

function jsonResponse(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const context = { totalSessions: 1, startDate: "2026-07-17", sessions: [], header: {} };

function installFetch(submit: Response) {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/link")) return Promise.resolve(jsonResponse({ valid: true }));
        if (url.endsWith("/context")) return Promise.resolve(jsonResponse(context));
        if (url.endsWith("/sessions/1/submit")) return Promise.resolve(submit);
        return Promise.resolve(jsonResponse({}, 404));
    }) as unknown as typeof fetch;
}

describe("service-record page submit errors", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    async function submit() {
        const user = userEvent.setup();
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
        await user.click(screen.getByRole("button", { name: "open submit modal" }));
        await user.click(await screen.findByRole("button", { name: "확인" }));
    }

    it("explains a REQUEST_CONFLICT (409) from the submit endpoint", async () => {
        installFetch(jsonResponse({ code: "REQUEST_CONFLICT" }, 409));
        await submit();
        expect(await screen.findByText("이미 처리되었거나 수정할 수 없는 상태예요.")).toBeInTheDocument();
    });

    it("keeps the generic message for an unregistered failure", async () => {
        installFetch(jsonResponse({}, 500));
        await submit();
        expect(await screen.findByText("제출에 실패했어요.")).toBeInTheDocument();
        expect(screen.queryByText("이미 처리되었거나 수정할 수 없는 상태예요.")).not.toBeInTheDocument();
    });
});
