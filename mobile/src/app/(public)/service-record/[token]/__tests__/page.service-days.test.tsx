import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import ServiceRecordPage from "../page";

jest.mock("next/navigation", () => ({ useParams: () => ({ token: "test-token" }) }));
jest.mock("@/hooks/useTokenBusinessDayCalendar", () => {
    // Imported inside the factory: jest hoists it above this file's own imports.
    const { KR_BUILTIN_CALENDAR: builtin } = jest.requireActual("@/lib/date/business-days");
    const result = { calendar: builtin, ready: true, error: null, retry: jest.fn() };
    return { useTokenBusinessDayCalendar: () => result };
});
jest.mock("@/components/app/service-record/ServiceRecordWizard", () => ({
    MobileServiceRecordWizard: (props: MobileServiceRecordWizardProps) => (
        <div>
            <span data-testid="screen">{props.screen}</span>
            <button onClick={() => props.onOpenDay(6)}>open day 6</button>
            <button onClick={props.onOpenDateSheet}>open date sheet</button>
            <span data-testid="date">{String(props.draft._date ?? "")}</span>
            {props.slots?.serviceDateSheet}
        </div>
    ),
}));

// Sessions 1-5 are submitted, so session 6 is enterable. It stays dateless until picked.
const DONE_SESSIONS = [14, 15, 16, 17, 18].map((date, index) => ({
    sessionIndex: index + 1,
    serviceDate: `2026-12-${date}`,
    locked: true,
}));
const BASE_CONTEXT = { totalSessions: 7, startDate: "2026-12-14", endDate: "2026-12-21", sessions: DONE_SESSIONS, header: {} };

describe("token service-record page and per-client service days", () => {
    beforeEach(() => {
        // Keep today's label deterministic while preserving real async timers.
        jest.useFakeTimers({
            now: new Date("2026-11-11T03:00:00Z"),
            doNotFake: [
                "hrtime", "nextTick", "performance", "queueMicrotask",
                "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
                "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout",
            ],
        });
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    async function openDaySix(context: Record<string, unknown>) {
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ...BASE_CONTEXT, ...context }) });
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
        fireEvent.click(screen.getByText("open day 6"));
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("day"));
    }

    it("leaves an unwritten session dateless with no policy", async () => {
        await openDaySix({});
        expect(screen.getByTestId("date")).toBeEmptyDOMElement();
    });

    it("leaves an unwritten session dateless with weekends off", async () => {
        await openDaySix({ serviceDays: { saturday: false, sunday: false, holiday: false } });
        expect(screen.getByTestId("date")).toBeEmptyDOMElement();
    });

    it("does not seed a date even when Saturday service is on", async () => {
        await openDaySix({ serviceDays: { saturday: true, sunday: false, holiday: false } });
        expect(screen.getByTestId("date")).toBeEmptyDOMElement();
        expect(new Date("2026-12-19T00:00:00Z").getUTCDay()).toBe(6);
    });

    it("lets the caregiver pick an in-window Saturday when the client allows Saturday service", async () => {
        await openDaySix({ serviceDays: { saturday: true, sunday: false, holiday: false } });
        fireEvent.click(screen.getByText("open date sheet"));

        const sheet = within(screen.getByRole("dialog", { name: "6회차 서비스 제공일" }));
        const saturday = sheet.getByRole("button", { name: "2026.12.19(토)" });
        expect(saturday).toHaveAttribute("aria-disabled", "false");
        fireEvent.click(saturday);
        expect(sheet.getByRole("button", { name: "선택" })).toBeEnabled();
        fireEvent.click(sheet.getByRole("button", { name: "선택" }));

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByTestId("date")).toHaveTextContent("2026-12-19");
    });

    it("blocks the same in-window Saturday when Saturday service is off", async () => {
        await openDaySix({ serviceDays: { saturday: false, sunday: false, holiday: false } });
        fireEvent.click(screen.getByText("open date sheet"));

        const sheet = within(screen.getByRole("dialog", { name: "6회차 서비스 제공일" }));
        const saturday = sheet.getByRole("button", { name: "2026.12.19(토)" });
        expect(saturday).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(saturday);
        expect(saturday).toHaveAttribute("aria-pressed", "false");
        expect(sheet.getByRole("button", { name: "선택" })).toBeDisabled();
        expect(screen.getByTestId("date")).toBeEmptyDOMElement();
    });
});
