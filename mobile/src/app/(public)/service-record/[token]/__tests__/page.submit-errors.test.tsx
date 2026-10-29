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
            <span data-testid="phone-notice">{props.phoneNotice ?? ""}</span>
            <button onClick={() => props.onOpenSubmitModal()}>open submit modal</button>
            <button onClick={() => void props.onSaveHeader()}>save header</button>
            <button onClick={() => void props.onOpenScheduleChangePreview()}>open schedule preview</button>
            <button onClick={() => props.onOpenDay(1)}>open day 1</button>
            <button onClick={() => props.onPhoneChange("01012345678")}>type phone</button>
            <button onClick={() => void props.onSubmitPhone()}>verify phone</button>
            {props.slots?.submitModal}
            {props.slots?.scheduleChangeModal}
            {props.slots?.errorNotification}
        </div>
    ),
}));

function jsonResponse(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const context = { totalSessions: 1, startDate: "2026-07-17", sessions: [], header: {} };

type Routes = Record<string, Response | (() => Response)>;

function installFetch(submit: Response, routes: Routes = {}) {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix))?.[1];
        if (route) return Promise.resolve(typeof route === "function" ? route() : route);
        if (url.endsWith("/link")) return Promise.resolve(jsonResponse({ valid: true }));
        if (url.endsWith("/context")) return Promise.resolve(jsonResponse(context));
        if (url.endsWith("/sessions/1/submit")) return Promise.resolve(submit);
        return Promise.resolve(jsonResponse({}, 404));
    }) as unknown as typeof fetch;
}

const AUTH_NOTICE = "안전을 위해 휴대폰 번호를 다시 확인해 주세요.";
const AUTH_REQUIRED_MESSAGE = "로그인이 필요해요. 다시 로그인해 주세요.";

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

    it("keeps a 409 on the screen with no phone notice", async () => {
        installFetch(jsonResponse({ code: "REQUEST_CONFLICT" }, 409));
        await submit();
        expect(await screen.findByText("이미 처리되었거나 수정할 수 없는 상태예요.")).toBeInTheDocument();
        expect(screen.getByTestId("screen")).toHaveTextContent("overview");
        expect(screen.getByTestId("phone-notice")).toBeEmptyDOMElement();
    });

    describe("a write refused for auth", () => {
        async function renderOverview() {
            const user = userEvent.setup();
            render(<ServiceRecordPage />);
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
            expect(screen.getByTestId("phone-notice")).toBeEmptyDOMElement();
            return user;
        }

        async function expectSentToPhone() {
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("phone"));
            expect(screen.getByTestId("phone-notice")).toHaveTextContent(AUTH_NOTICE);
            expect(screen.queryByText(AUTH_REQUIRED_MESSAGE)).not.toBeInTheDocument();
        }

        it("sends a 401 on header save to the phone screen with the notice", async () => {
            installFetch(jsonResponse({}), { "/header": jsonResponse({ code: "AUTH_REQUIRED" }, 401) });
            const user = await renderOverview();
            await user.click(screen.getByRole("button", { name: "save header" }));
            await expectSentToPhone();
        });

        it("sends a 401 on submit to the phone screen with the notice and closes the submit modal", async () => {
            installFetch(jsonResponse({ code: "AUTH_REQUIRED" }, 401));
            await submit();
            await expectSentToPhone();
            expect(screen.queryByRole("button", { name: "확인" })).not.toBeInTheDocument();
        });

        it("sends a 403 on submit to the phone screen with the notice", async () => {
            installFetch(jsonResponse({ code: "FORBIDDEN" }, 403));
            await submit();
            await expectSentToPhone();
        });

        it("sends a 401 on the schedule-change preview to the phone screen and closes the modal", async () => {
            installFetch(jsonResponse({}), {
                "/schedule-change/preview": jsonResponse({ code: "AUTH_REQUIRED" }, 401),
            });
            const user = await renderOverview();
            await user.click(screen.getByRole("button", { name: "open schedule preview" }));
            await expectSentToPhone();
            expect(screen.queryByText("서비스 일정 변경")).not.toBeInTheDocument();
        });

        it("sends a 401 on the schedule-change request to the phone screen and closes the modal", async () => {
            const preview = { sessionIndex: 1, fromDate: "2026-07-20", toDate: "2026-07-21" };
            installFetch(jsonResponse({}), {
                "/schedule-change/preview": jsonResponse(preview),
                "/schedule-change": jsonResponse({ code: "AUTH_REQUIRED" }, 401),
            });
            const user = await renderOverview();
            await user.click(screen.getByRole("button", { name: "open schedule preview" }));
            await user.click(await screen.findByRole("button", { name: "승인 요청" }));
            await expectSentToPhone();
            expect(screen.queryByRole("button", { name: "승인 요청" })).not.toBeInTheDocument();
        });

        it("clears the notice once the caregiver verifies again", async () => {
            installFetch(jsonResponse({ code: "AUTH_REQUIRED" }, 401), { "/verify": jsonResponse({ ok: true }) });
            const user = userEvent.setup();
            render(<ServiceRecordPage />);
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
            await user.click(screen.getByRole("button", { name: "open submit modal" }));
            await user.click(await screen.findByRole("button", { name: "확인" }));
            await expectSentToPhone();

            await user.click(screen.getByRole("button", { name: "type phone" }));
            await user.click(screen.getByRole("button", { name: "verify phone" }));
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
            expect(screen.getByTestId("phone-notice")).toBeEmptyDOMElement();
        });

        it("keeps a stored new-day draft across the round trip", async () => {
            const key = "daily-service-record-draft:test-token";
            window.sessionStorage.setItem(key, JSON.stringify({ day: 1, pageIdx: 2, draft: { notes: "keep me" } }));
            installFetch(jsonResponse({ code: "AUTH_REQUIRED" }, 401), { "/verify": jsonResponse({ ok: true }) });
            const user = userEvent.setup();
            render(<ServiceRecordPage />);
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
            await user.click(screen.getByRole("button", { name: "open day 1" }));
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("day"));
            await user.click(screen.getByRole("button", { name: "open submit modal" }));
            await user.click(await screen.findByRole("button", { name: "확인" }));
            await expectSentToPhone();
            expect(JSON.parse(window.sessionStorage.getItem(key) ?? "null")?.draft?.notes).toBe("keep me");

            await user.click(screen.getByRole("button", { name: "type phone" }));
            await user.click(screen.getByRole("button", { name: "verify phone" }));
            await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
            expect(JSON.parse(window.sessionStorage.getItem(key) ?? "null")?.draft?.notes).toBe("keep me");
        });
    });
});
