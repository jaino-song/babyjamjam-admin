import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ServiceRecordPage from "../page";

let mockToken = "first-baby-fixture";
jest.mock("next/navigation", () => ({ useParams: () => ({ token: mockToken }) }));
jest.mock("@/hooks/useTokenBusinessDayCalendar", () => {
    const { KR_BUILTIN_CALENDAR } = jest.requireActual("@/lib/date/business-days");
    const value = { calendar: KR_BUILTIN_CALENDAR, ready: true, error: null, retry: jest.fn() };
    return { useTokenBusinessDayCalendar: () => value };
});

const first = { token: "first-baby-fixture", title: "첫째 아기 제공기록지", rank: 1 };
const second = { token: "second-baby-fixture", title: "둘째 아기 제공기록지", rank: 2 };
const storageKey = (token: string) => `daily-service-record-draft:${token}`;

function json(body: unknown, status = 200): Response {
    return { ok: status < 400, status, json: async () => body } as Response;
}

it("switching first to second and back keeps each baby draft", async () => {
    window.sessionStorage.clear();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const [, , , token, endpoint] = String(input).split("/");
        const baby = [first, second].find(candidate => candidate.token === token);
        if (!baby) return json({}, 404);
        if (endpoint === "link") return json({ valid: true });
        if (endpoint === "context") return json({
            babyId: token, babyRank: baby.rank, babyCount: 2,
            header: { babyName: baby.title },
            startDate: "2026-07-20", endDate: "2026-07-31", totalSessions: 2,
            sessions: [{ sessionIndex: 1, serviceDate: "2026-07-20", answers: { meals_meal: baby.rank }, locked: false }],
        });
        return json({}, 404);
    });

    function select(baby: typeof first) {
        mockToken = baby.token;
        window.history.replaceState(null, "", `/service-record/${baby.token}`);
    }

    async function openDraft(baby: typeof first) {
        expect(await screen.findByRole("heading", { name: baby.title })).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "기록 시작" }));
        return screen.findByLabelText("식사", { exact: true }) as Promise<HTMLInputElement>;
    }

    try {
        select(first);
        const view = render(<ServiceRecordPage />);
        const inputA = await openDraft(first);
        expect(inputA.value).toBe("1");
        fireEvent.change(inputA, { target: { value: "3" } });

        select(second);
        view.rerender(<ServiceRecordPage />);
        expect(screen.queryByRole("heading", { name: first.title })).toBeNull();
        const inputB = await openDraft(second);
        expect(inputB.value).toBe("2");
        fireEvent.change(inputB, { target: { value: "4" } });

        select(first);
        view.rerender(<ServiceRecordPage />);
        expect((await openDraft(first)).value).toBe("3");
        await waitFor(() => {
            for (const [baby, mealCount] of [[first, "3"], [second, "4"]] as const) {
                const raw = window.sessionStorage.getItem(storageKey(baby.token));
                expect(JSON.parse(raw ?? "{}")).toMatchObject({
                    drafts: { 1: { draft: { meals_meal: mealCount } } },
                });
            }
        });
    } finally {
        globalThis.fetch = originalFetch;
        window.sessionStorage.clear();
    }
});
