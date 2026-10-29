import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import ServiceRecordPage from "../page";

// The real ApprovalTwoButtonModal (Radix) is deliberately NOT mocked here.
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
            <span data-testid="editing">{String(props.editing)}</span>
            <span data-testid="page-idx">{props.pageIdx}</span>
            <button onClick={() => props.onOpenDay(1)}>open day 1</button>
            <button onClick={() => props.onOpenSubmitModal()}>open submit modal</button>
            {props.slots?.submitModal}
        </div>
    ),
}));

function jsonResponse(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function session(sessionIndex: number, locked: boolean) {
    return {
        sessionIndex,
        locked,
        serviceDate: `2026-07-${16 + sessionIndex}`,
        answers: {},
        etcService: "",
        notes: "",
        paymentConfirmed: true,
        clientSignature: "signed",
    };
}

function installFetch(sessions: ReturnType<typeof session>[], submit: Response = jsonResponse({})) {
    const context = { totalSessions: sessions.length, startDate: "2026-07-17", sessions, header: { name: "x" } };
    global.fetch = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/link")) return Promise.resolve(jsonResponse({ valid: true }));
        if (url.endsWith("/context")) return Promise.resolve(jsonResponse(context));
        if (url.endsWith("/sessions/1/submit")) return Promise.resolve(submit);
        return Promise.resolve(jsonResponse({}, 404));
    }) as unknown as typeof fetch;
}

describe("service-record page edit snackbar", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    afterEach(async () => {
        // The toast store is module-level; empty it so tests do not see each other.
        const { result, unmount } = renderHook(() => useToast());
        act(() => result.current.dismiss());
        await waitFor(() => expect(result.current.toasts).toHaveLength(0));
        unmount();
    });

    async function openAndConfirm(initialScreen: string) {
        const user = userEvent.setup();
        render(
            <>
                <ServiceRecordPage />
                <Toaster />
            </>,
        );
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent(initialScreen));
        await user.click(screen.getByRole("button", { name: "open day 1" }));
        await user.click(screen.getByRole("button", { name: "open submit modal" }));
        await user.click(await screen.findByRole("button", { name: "확인" }));
        return user;
    }

    it("shows a success snackbar after editing a submitted session, landing on the overview", async () => {
        installFetch([session(1, true), session(2, false)]);
        await openAndConfirm("overview");

        expect(await screen.findByText("1회차 수정이 저장됐어요")).toBeInTheDocument();
        expect(screen.getByTestId("screen")).toHaveTextContent("overview");
        expect(screen.getByRole("button", { name: "기록 보기" })).toBeInTheDocument();
    });

    it("기록 보기 opens that session's submitted-record review from the overview", async () => {
        installFetch([session(1, true), session(2, false)]);
        const user = await openAndConfirm("overview");

        await user.click(await screen.findByRole("button", { name: "기록 보기" }));

        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("day"));
        expect(screen.getByTestId("day")).toHaveTextContent("1");
        expect(screen.getByTestId("editing")).toHaveTextContent("true");
        // The review page is the last page of the day flow.
        expect(Number(screen.getByTestId("page-idx").textContent)).toBeGreaterThan(0);
        await waitFor(() => expect(screen.queryByText("1회차 수정이 저장됐어요")).not.toBeInTheDocument());
    });

    it("shows the snackbar and a working 기록 보기 when every session is locked (done screen)", async () => {
        installFetch([session(1, true)]);
        const user = await openAndConfirm("done");

        expect(await screen.findByText("1회차 수정이 저장됐어요")).toBeInTheDocument();
        expect(screen.getByTestId("screen")).toHaveTextContent("done");

        await user.click(screen.getByRole("button", { name: "기록 보기" }));

        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("day"));
        expect(screen.getByTestId("day")).toHaveTextContent("1");
        expect(screen.getByTestId("editing")).toHaveTextContent("true");
    });

    it("shows no snackbar for a first submit", async () => {
        installFetch([session(1, false), session(2, false)]);
        await openAndConfirm("overview");

        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
        expect(screen.getByTestId("editing")).toHaveTextContent("false");
        expect(screen.queryByText(/수정이 저장됐어요/)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "기록 보기" })).not.toBeInTheDocument();
    });

    it("shows no snackbar when the edit submit fails", async () => {
        installFetch([session(1, true), session(2, false)], jsonResponse({}, 500));
        await openAndConfirm("overview");

        await waitFor(() => expect(screen.getByTestId("editing")).toHaveTextContent("true"));
        expect(screen.queryByText(/수정이 저장됐어요/)).not.toBeInTheDocument();
    });
});
