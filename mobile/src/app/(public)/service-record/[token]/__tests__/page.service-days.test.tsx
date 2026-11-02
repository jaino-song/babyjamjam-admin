import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
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
            <span data-testid="date">{String(props.draft._date ?? "")}</span>
        </div>
    ),
}));

// Sessions 1-5 are done on Monday 12-14 .. Friday 12-18, so session 6 is the next one to open. Its
// default date is Monday 12-21 with weekends skipped, and Saturday 12-19 when the client's Saturday
// service is on.
const DONE_SESSIONS = [14, 15, 16, 17, 18].map((date, index) => ({
    sessionIndex: index + 1,
    serviceDate: `2026-12-${date}`,
    locked: true,
}));
const BASE_CONTEXT = { totalSessions: 7, startDate: "2026-12-14", sessions: DONE_SESSIONS, header: {} };

describe("token service-record page and per-client service days", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
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

    it("is unchanged when the context carries no service days", async () => {
        await openDaySix({});
        expect(screen.getByTestId("date")).toHaveTextContent("2026-12-21");
    });

    it("is unchanged when every service day is off", async () => {
        await openDaySix({ serviceDays: { saturday: false, sunday: false, holiday: false } });
        expect(screen.getByTestId("date")).toHaveTextContent("2026-12-21");
    });

    it("lands a later session on Saturday when Saturday service is on", async () => {
        await openDaySix({ serviceDays: { saturday: true, sunday: false, holiday: false } });
        expect(screen.getByTestId("date")).toHaveTextContent("2026-12-19");
        expect(new Date("2026-12-19T00:00:00Z").getUTCDay()).toBe(6);
        expect(KR_BUILTIN_CALENDAR.isBusinessDay("2026-12-19")).toBe(false);
    });
});
