import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MobileServiceRecordWizardProps } from "@/components/app/service-record/ServiceRecordWizard";
import ServiceRecordPage from "../page";

jest.mock("next/navigation", () => ({ useParams: () => ({ token: "test-token" }) }));
jest.mock("@/hooks/useTokenBusinessDayCalendar", () => ({
    useTokenBusinessDayCalendar: () => ({
        calendar: { isBusinessDay: () => true, diffBusinessDays: () => 5 },
        ready: true, error: null, retry: jest.fn(),
    }),
}));
jest.mock("@/components/app/service-record/ServiceRecordWizard", () => ({
    MobileServiceRecordWizard: (props: MobileServiceRecordWizardProps) => (
        <div>
            <span data-testid="screen">{props.screen}</span>
            <button onClick={() => props.onOpenDay(1)}>open day</button>
            <button onClick={() => props.onServiceDateChange("2026-07-24")}>change date</button>
            <span data-testid="date">{String(props.draft._date ?? "")}</span>
            <span data-testid="notes">{String(props.draft.notes ?? "")}</span>
            {props.slots?.serviceDateChangeModal}
        </div>
    ),
}));
jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
    MobileTwoButtonModal: ({ open, description }: { open: boolean; description: string }) =>
        open ? <div role="dialog">{description}</div> : null,
}));

describe("token planned-date drafts", () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/test-token");
    });

    async function openStoredDraft(planned: boolean, storedDate = "2026-07-24") {
        window.sessionStorage.setItem("daily-service-record-draft:test-token", JSON.stringify({
            day: 1, pageIdx: 0, draft: { _date: storedDate, notes: "saved notes" },
        }));
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true, json: async () => ({ valid: true }),
        }).mockResolvedValueOnce({
            ok: true, json: async () => ({
                totalSessions: 1, startDate: "2026-07-17", sessions: [], header: {},
                ...(planned ? { plannedSessionDates: [{ sessionIndex: 1, serviceDate: "2026-07-17" }] } : {}),
            }),
        });
        render(<ServiceRecordPage />);
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("overview"));
        fireEvent.click(screen.getByText("open day"));
        await waitFor(() => expect(screen.getByTestId("screen")).toHaveTextContent("day"));
    }

    it("discards a mismatching stored date but preserves other answers", async () => {
        await openStoredDraft(true);
        expect(screen.getByTestId("date")).toHaveTextContent("2026-07-17");
        expect(screen.getByTestId("notes")).toHaveTextContent("saved notes");
        const stored = JSON.parse(window.sessionStorage.getItem("daily-service-record-draft:test-token")!);
        expect(stored.draft._date).toBe("2026-07-17");
    });

    it("does not open an extension confirmation for planned dates", async () => {
        await openStoredDraft(true, "2026-07-17");
        fireEvent.click(screen.getByText("change date"));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.getByTestId("date")).toHaveTextContent("2026-07-17");
    });

    it("preserves unplanned stored date overrides and their confirmation", async () => {
        await openStoredDraft(false);
        expect(screen.getByTestId("date")).toHaveTextContent("2026-07-24");
        fireEvent.click(screen.getByText("change date"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
});
