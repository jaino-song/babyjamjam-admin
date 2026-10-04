import { Logger } from "@nestjs/common";

import {
    ApplyReviewEventInput,
    ApplyReviewEventResult,
    HolidayChangeEventRecord,
    IHolidayReviewRepository,
    OpenReviewItemRef,
    ReviewCandidateClient,
} from "domain/repositories/holiday-review.repository.interface";
import {
    BranchHolidayOverrideRecord,
    IHolidayCalendarRepository,
} from "domain/repositories/holiday-calendar.repository.interface";
import { KOREAN_HOLIDAY_CALENDAR } from "domain/utils/business-days";
import { HolidayCalendarService } from "./holiday-calendar.service";
import { HOLIDAY_REVIEW_GRACE_MS, HolidayReviewProcessorService } from "./holiday-review-processor.service";

const BRANCH_A = "aaaaaaaa-1111-4111-8111-111111111111";
const BRANCH_B = "bbbbbbbb-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-01T12:00:00.000Z");
const OLD = new Date(NOW.getTime() - HOLIDAY_REVIEW_GRACE_MS - 60_000);

// 2026-11-02 is a Monday; ten business days from it end Fri 2026-11-13 without holidays.
const START = "2026-11-02";
const STORED_END = "2026-11-13";

function event(partial: Partial<HolidayChangeEventRecord> & Pick<HolidayChangeEventRecord, "id" | "date">): HolidayChangeEventRecord {
    return {
        branchId: null,
        change: "added",
        name: "임시공휴일",
        source: "kasi",
        createdAt: OLD,
        ...partial,
    };
}

function candidate(partial: Partial<ReviewCandidateClient> = {}): ReviewCandidateClient {
    return {
        clientId: 1,
        branchId: BRANCH_A,
        startDate: START,
        endDate: STORED_END,
        duration: 10,
        facts: { caseStatus: null, days: [] },
        ...partial,
    };
}

interface World {
    /** Public dates added on top of the built-in 2026 list (the 2026 year is "synced"). */
    publicExtra?: string[];
    overrides?: Record<string, BranchHolidayOverrideRecord[]>;
    queue?: HolidayChangeEventRecord[];
    candidates?: Record<string, ReviewCandidateClient[]>;
    /** Open items of EARLIER events, by client id. */
    openItems?: OpenReviewItemRef[];
    activeBranches?: string[];
    inactiveBranches?: string[];
    holdsLease?: boolean;
}

function override(branchId: string, date: string, kind: "add" | "exclude"): BranchHolidayOverrideRecord {
    return { id: `o-${branchId}-${date}`, branchId, date, kind, name: "x", createdBy: null, createdAt: NOW };
}

function makeProcessor(world: World = {}) {
    const calendarRepository = {
        readRevision: jest.fn(async () => 1),
        readCalendar: jest.fn(async (branchId: string) => ({
            revision: 1,
            snapshots: [{ year: 2026, validatedAt: NOW }],
            holidays: [...(KOREAN_HOLIDAY_CALENDAR[2026] ?? []), ...(world.publicExtra ?? [])].map((date) => ({
                date,
                name: "공휴일",
            })),
            overrides: world.overrides?.[branchId] ?? [],
        })),
        readSnapshotValidatedAt: jest.fn(async () => NOW),
        withOverrideTransaction: jest.fn(),
    } satisfies IHolidayCalendarRepository;
    const calendarService = new HolidayCalendarService(calendarRepository);

    // The queue shrinks as events are applied, like processed_at does in the database.
    const queue = [...(world.queue ?? [])];
    const repository = {
        listUnprocessedEvents: jest.fn(async () => [...queue]),
        listBranchOverrides: jest.fn(async (branchId: string) =>
            (world.overrides?.[branchId] ?? []).map(({ date, kind }) => ({ date, kind })),
        ),
        findReviewCandidates: jest.fn(async (branchId: string) => world.candidates?.[branchId] ?? []),
        listOpenItemsForClients: jest.fn(async (_exceptEventId: string, clientIds: number[]) =>
            (world.openItems ?? []).filter((item) => clientIds.includes(item.clientId)),
        ),
        applyEventResult: jest.fn<Promise<ApplyReviewEventResult>, [ApplyReviewEventInput]>(
            async ({ eventId }) => {
                const index = queue.findIndex((e) => e.id === eventId);
                if (index >= 0) queue.splice(index, 1);
                return { status: "applied", created: 0, obsoleted: 0 };
            },
        ),
    } satisfies Pick<
        IHolidayReviewRepository,
        | "listUnprocessedEvents"
        | "listBranchOverrides"
        | "findReviewCandidates"
        | "listOpenItemsForClients"
        | "applyEventResult"
    >;
    const branches = {
        findAll: jest.fn(async () =>
            [...(world.activeBranches ?? [BRANCH_A, BRANCH_B]), ...(world.inactiveBranches ?? [])]
                .map((id) => ({ id, name: id })),
        ),
        findAllActive: jest.fn(async () =>
            (world.activeBranches ?? [BRANCH_A, BRANCH_B]).map((id) => ({ id, name: id })),
        ),
    };
    const lease = { holdsLease: jest.fn(() => world.holdsLease ?? true) };
    const service = new HolidayReviewProcessorService(
        // The processor only uses the processing-side methods.
        repository as unknown as IHolidayReviewRepository,
        calendarService,
        branches,
        lease as never,
    );
    return { service, repository, branches, lease, calendarService, queue };
}

describe("HolidayReviewProcessorService", () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    describe("drafts", () => {
        it("drafts a safe item for a client whose stored end matched the calendar before the change", async () => {
            const e = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10"],
                queue: [e],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 1, stopped: false });
            expect(repository.applyEventResult).toHaveBeenCalledTimes(1);
            expect(repository.applyEventResult).toHaveBeenCalledWith({
                eventId: "e1",
                expectedUnprocessedEventIds: ["e1"],
                assumedOpenItemIds: {},
                drafts: [
                    {
                        clientId: 1,
                        branchId: BRANCH_A,
                        storedEnd: STORED_END,
                        recalculatedEnd: "2026-11-16",
                        previousEnd: STORED_END,
                        affectedFrom: "2026-11-10",
                        category: "safe",
                        reason: "no_sessions_after_date",
                    },
                ],
            });
        });

        it("B1: a later event keeps the earlier change's date, so sessions since the first change still count", async () => {
            // e1 (11-04) was risky because of the 11-04 session; e2 (11-11) replaces its open item.
            const e2 = event({ id: "e2", date: "2026-11-11" });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-04", "2026-11-11"],
                queue: [e2],
                openItems: [{ id: "item-e1", clientId: 1, affectedFrom: "2026-11-04" }],
                candidates: {
                    [BRANCH_A]: [
                        candidate({ facts: { caseStatus: null, days: [{ date: "2026-11-04", locked: false }] } }),
                    ],
                },
            });

            await service.processDueEvents(NOW);

            const input = repository.applyEventResult.mock.calls[0]![0];
            expect(input.assumedOpenItemIds).toEqual({ 1: "item-e1" });
            expect(input.drafts[0]).toMatchObject({
                affectedFrom: "2026-11-04",
                category: "risk",
                reason: "session_on_or_after_date",
            });
        });

        it("B1 negative control: with the event's own date alone the same client would be safe", async () => {
            const e2 = event({ id: "e2", date: "2026-11-11" });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-04", "2026-11-11"],
                queue: [e2],
                candidates: {
                    [BRANCH_A]: [
                        candidate({ facts: { caseStatus: null, days: [{ date: "2026-11-04", locked: false }] } }),
                    ],
                },
            });

            await service.processDueEvents(NOW);

            expect(repository.applyEventResult.mock.calls[0]![0].drafts[0]).toMatchObject({
                affectedFrom: "2026-11-11",
                category: "safe",
            });
        });

        it("B1: an open item with a LATER affectedFrom never moves the new item's date forward", async () => {
            const e = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10"],
                queue: [e],
                openItems: [{ id: "item-x", clientId: 1, affectedFrom: "2026-11-20" }],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            await service.processDueEvents(NOW);

            expect(repository.applyEventResult.mock.calls[0]![0].drafts[0]!.affectedFrom).toBe("2026-11-10");
        });

        it("targets every active branch for a public event and uses the CLIENT's branch id on each draft", async () => {
            const e = event({ id: "e1", date: "2026-11-10" });
            const { service, repository, branches } = makeProcessor({
                publicExtra: ["2026-11-10"],
                queue: [e],
                candidates: {
                    [BRANCH_A]: [candidate({ clientId: 1, branchId: BRANCH_A })],
                    [BRANCH_B]: [candidate({ clientId: 2, branchId: BRANCH_B })],
                },
            });

            await service.processDueEvents(NOW);

            expect(branches.findAll).toHaveBeenCalledTimes(1);
            expect(branches.findAllActive).not.toHaveBeenCalled();
            expect(repository.findReviewCandidates).toHaveBeenCalledWith(BRANCH_A, "2026-11-10");
            expect(repository.findReviewCandidates).toHaveBeenCalledWith(BRANCH_B, "2026-11-10");
            const drafts = repository.applyEventResult.mock.calls[0]![0].drafts;
            expect(drafts.map((d) => [d.clientId, d.branchId])).toEqual([
                [1, BRANCH_A],
                [2, BRANCH_B],
            ]);
        });

        it("drafts items for inactive branches on a public event and processes the event only once", async () => {
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10"],
                queue: [event({ id: "e1", date: "2026-11-10" })],
                activeBranches: [BRANCH_A],
                inactiveBranches: [BRANCH_B],
                candidates: {
                    [BRANCH_A]: [candidate()],
                    [BRANCH_B]: [candidate({ clientId: 2, branchId: BRANCH_B })],
                },
            });

            await expect(service.processDueEvents(NOW)).resolves.toEqual({ processed: 1, stopped: false });

            expect(repository.applyEventResult.mock.calls[0]![0].drafts).toEqual([
                expect.objectContaining({ clientId: 1, branchId: BRANCH_A, recalculatedEnd: "2026-11-16" }),
                expect.objectContaining({
                    clientId: 2,
                    branchId: BRANCH_B,
                    storedEnd: STORED_END,
                    previousEnd: STORED_END,
                    recalculatedEnd: "2026-11-16",
                    category: "safe",
                }),
            ]);
            await expect(service.processDueEvents(NOW)).resolves.toEqual({ processed: 0, stopped: false });
            expect(repository.applyEventResult).toHaveBeenCalledTimes(1);
        });

        it("only looks at the event's own branch for a branch event", async () => {
            const e = event({ id: "e1", branchId: BRANCH_A, date: "2026-11-10", source: "branch-override" });
            const { service, repository, branches } = makeProcessor({
                overrides: { [BRANCH_A]: [override(BRANCH_A, "2026-11-10", "add")] },
                queue: [e],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            await service.processDueEvents(NOW);

            expect(branches.findAllActive).not.toHaveBeenCalled();
            expect(branches.findAll).not.toHaveBeenCalled();
            expect(repository.findReviewCandidates).toHaveBeenCalledTimes(1);
            expect(repository.findReviewCandidates).toHaveBeenCalledWith(BRANCH_A, "2026-11-10");
            expect(repository.applyEventResult.mock.calls[0]![0].drafts).toHaveLength(1);
        });

        it("classifies each risk reason from the client's recorded service", async () => {
            const e = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10"],
                queue: [e],
                candidates: {
                    [BRANCH_A]: [
                        candidate({ clientId: 1, facts: { caseStatus: "COMPLETED", days: [] } }),
                        candidate({
                            clientId: 2,
                            facts: { caseStatus: null, days: [{ date: "2026-11-11", locked: false }] },
                        }),
                        candidate({ clientId: 3 }),
                    ],
                },
            });

            await service.processDueEvents(NOW);

            const drafts = repository.applyEventResult.mock.calls[0]![0].drafts;
            expect(drafts.map((d) => [d.clientId, d.category, d.reason])).toEqual([
                [1, "risk", "finalized"],
                [2, "risk", "session_on_or_after_date"],
                [3, "safe", "no_sessions_after_date"],
            ]);
        });

        it("recalculates an earlier end when a holiday is removed, and a session before the change stays safe", async () => {
            // 2026-11-10 stops being a holiday: the client's end moves from 11-16 back to 11-13.
            const e = event({ id: "e1", date: "2026-11-10", change: "removed" });
            const { service, repository } = makeProcessor({
                queue: [e],
                candidates: {
                    [BRANCH_A]: [
                        candidate({
                            endDate: "2026-11-16",
                            // Recorded before the removed date, but locked after the new end.
                            facts: { caseStatus: null, days: [{ date: "2026-11-09", locked: true }] },
                            startDate: "2026-11-09",
                            duration: 5,
                        }),
                    ],
                },
            });

            await service.processDueEvents(NOW);

            const [draft] = repository.applyEventResult.mock.calls[0]![0].drafts;
            expect(draft).toMatchObject({ storedEnd: "2026-11-16", recalculatedEnd: "2026-11-13" });
            // 11-09 is before the change date and before the new end: still safe.
            expect(draft!.category).toBe("safe");
        });

        it("hands over a client whose stored end already differed so the repository can skip it", async () => {
            const e = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10"],
                queue: [e],
                candidates: { [BRANCH_A]: [candidate({ endDate: "2026-11-12" })] },
            });

            await service.processDueEvents(NOW);

            const [draft] = repository.applyEventResult.mock.calls[0]![0].drafts;
            // previousEnd (11-13) != stored (11-12): decideReviewItemAction creates nothing.
            expect(draft).toMatchObject({ storedEnd: "2026-11-12", previousEnd: "2026-11-13" });
        });

        it("skips a client whose year has no calendar data without failing the batch", async () => {
            const e = event({ id: "e1", date: "2028-03-07" });
            const { service, repository } = makeProcessor({
                queue: [e],
                candidates: {
                    [BRANCH_A]: [candidate({ startDate: "2028-03-01", endDate: "2028-03-14" })],
                },
            });

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 1, stopped: false });
            expect(repository.applyEventResult.mock.calls[0]![0].drafts).toEqual([]);
        });

        it("skips a client whose end date cannot be derived", async () => {
            const e = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10"],
                queue: [e],
                candidates: { [BRANCH_A]: [candidate({ duration: 0 })] },
            });

            await service.processDueEvents(NOW);

            expect(repository.applyEventResult.mock.calls[0]![0].drafts).toEqual([]);
        });
    });

    describe("no-op rules", () => {
        it.each(["exclude", "add"] as const)(
            "a public event is a no-op for a branch with an %s override on the date",
            async (kind) => {
                const e = event({ id: "e1", date: "2026-11-10" });
                const { service, repository } = makeProcessor({
                    publicExtra: ["2026-11-10"],
                    overrides: { [BRANCH_A]: [override(BRANCH_A, "2026-11-10", kind)] },
                    queue: [e],
                    candidates: { [BRANCH_A]: [candidate({ clientId: 1 })], [BRANCH_B]: [candidate({ clientId: 2, branchId: BRANCH_B })] },
                });

                await service.processDueEvents(NOW);

                expect(repository.findReviewCandidates).not.toHaveBeenCalledWith(BRANCH_A, expect.anything());
                expect(repository.findReviewCandidates).toHaveBeenCalledWith(BRANCH_B, "2026-11-10");
                // The event is still marked processed, with only the other branch's draft.
                expect(repository.applyEventResult.mock.calls[0]![0].drafts.map((d) => d.clientId)).toEqual([2]);
            },
        );

        it("a branch event is a no-op once the date's status no longer matches its direction", async () => {
            // 'added' event, but the branch has since removed its add (date is a business day again).
            const e = event({ id: "e1", branchId: BRANCH_A, date: "2026-11-10", source: "branch-override" });
            const { service, repository } = makeProcessor({
                queue: [e],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            const summary = await service.processDueEvents(NOW);

            expect(summary.processed).toBe(1);
            expect(repository.findReviewCandidates).not.toHaveBeenCalled();
            expect(repository.applyEventResult.mock.calls[0]![0].drafts).toEqual([]);
        });

        it("a branch 'removed' event applies while the date is still a business day for the branch", async () => {
            const e = event({
                id: "e1",
                branchId: BRANCH_A,
                date: "2026-12-25",
                change: "removed",
                source: "branch-override",
            });
            // 2026-12-25 is a public holiday; the branch excluded it, so it is a business day there.
            const { service, repository } = makeProcessor({
                overrides: { [BRANCH_A]: [override(BRANCH_A, "2026-12-25", "exclude")] },
                queue: [e],
                candidates: { [BRANCH_A]: [candidate({ startDate: "2026-12-14", endDate: "2026-12-25", duration: 10 })] },
            });

            await service.processDueEvents(NOW);

            expect(repository.findReviewCandidates).toHaveBeenCalledWith(BRANCH_A, "2026-12-25");
        });
    });

    describe("previous calendar", () => {
        it("undoes the event and every later unprocessed event that applies to the branch", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10", createdAt: OLD });
            const e2 = event({ id: "e2", date: "2026-11-11", createdAt: new Date(OLD.getTime() + 1000) });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10", "2026-11-11"],
                queue: [e1, e2],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            await service.processDueEvents(NOW);

            const [first, second] = repository.applyEventResult.mock.calls.map((call) => call[0]);
            expect(first!.eventId).toBe("e1");
            expect(first!.expectedUnprocessedEventIds).toEqual(["e1", "e2"]);
            // Both holidays are undone: previous == the pre-change calendar == stored.
            expect(first!.drafts[0]).toMatchObject({
                storedEnd: STORED_END,
                previousEnd: STORED_END,
                recalculatedEnd: "2026-11-17",
            });
            // e1 is processed now, so only e2 is undone and e1's holiday stays in the previous calendar.
            expect(second!.eventId).toBe("e2");
            expect(second!.drafts[0]).toMatchObject({ previousEnd: "2026-11-16", recalculatedEnd: "2026-11-17" });
        });

        it("includes later events still inside the grace window", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            const young = event({ id: "e2", date: "2026-11-11", createdAt: new Date(NOW.getTime() - 30_000) });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10", "2026-11-11"],
                queue: [e1, young],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 1, stopped: false });
            expect(repository.applyEventResult).toHaveBeenCalledTimes(1);
            expect(repository.applyEventResult.mock.calls[0]![0].drafts[0]).toMatchObject({ previousEnd: STORED_END });
        });

        it("ignores later events that are no-ops for the branch", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            // The branch excluded 11-11, so the later public event for it does not apply here.
            const e2 = event({ id: "e2", date: "2026-11-11", createdAt: new Date(OLD.getTime() + 1000) });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10", "2026-11-11"],
                overrides: { [BRANCH_A]: [override(BRANCH_A, "2026-11-11", "exclude")] },
                queue: [e1, e2],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            await service.processDueEvents(NOW);

            // Calendar: 11-10 public, 11-11 excluded -> end 11-16. Previous: undo 11-10 only -> 11-13.
            expect(repository.applyEventResult.mock.calls[0]![0].drafts[0]).toMatchObject({
                recalculatedEnd: "2026-11-16",
                previousEnd: STORED_END,
            });
        });

        it("ignores later events of other branches", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            const other = event({
                id: "e2",
                branchId: BRANCH_B,
                date: "2026-11-11",
                source: "branch-override",
                createdAt: new Date(OLD.getTime() + 1000),
            });
            const { service, repository } = makeProcessor({
                publicExtra: ["2026-11-10"],
                overrides: { [BRANCH_B]: [override(BRANCH_B, "2026-11-11", "add")] },
                queue: [e1, other],
                candidates: { [BRANCH_A]: [candidate()] },
            });

            await service.processDueEvents(NOW);

            expect(repository.applyEventResult.mock.calls[0]![0].drafts[0]).toMatchObject({
                recalculatedEnd: "2026-11-16",
                previousEnd: STORED_END,
            });
        });
    });

    describe("queue handling", () => {
        it("does not process an event inside the 2-minute grace window", async () => {
            const young = event({ id: "e1", date: "2026-11-10", createdAt: new Date(NOW.getTime() - 119_000) });
            const { service, repository } = makeProcessor({ queue: [young] });

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 0, stopped: false });
            expect(repository.applyEventResult).not.toHaveBeenCalled();
        });

        it("processes an event once the grace window has passed, oldest first", async () => {
            const a = event({ id: "a", date: "2026-11-10", createdAt: new Date(NOW.getTime() - 121_000) });
            const b = event({ id: "b", date: "2026-11-11", createdAt: new Date(NOW.getTime() - 200_000) });
            const { service, repository } = makeProcessor({ queue: [b, a] });

            const summary = await service.processDueEvents(NOW);

            expect(summary.processed).toBe(2);
            expect(repository.applyEventResult.mock.calls.map((c) => c[0].eventId)).toEqual(["b", "a"]);
        });

        it("a failing event stops the batch and is not retried within the run", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            const e2 = event({ id: "e2", date: "2026-11-11", createdAt: new Date(OLD.getTime() + 1000) });
            const { service, repository } = makeProcessor({ queue: [e1, e2] });
            repository.applyEventResult.mockRejectedValueOnce(new Error("deadlock"));

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 0, stopped: true });
            expect(repository.applyEventResult).toHaveBeenCalledTimes(1);
            expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining("e1"));
        });

        it("stops the batch when loading the branch data fails", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({ queue: [e1] });
            repository.findReviewCandidates.mockRejectedValueOnce(new Error("db down"));

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 0, stopped: true });
            expect(repository.applyEventResult).not.toHaveBeenCalled();
        });

        it("moves on when another run already processed the event", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            const e2 = event({ id: "e2", date: "2026-11-11", createdAt: new Date(OLD.getTime() + 1000) });
            const { service, repository, queue } = makeProcessor({ queue: [e1, e2] });
            repository.applyEventResult.mockImplementationOnce(async () => {
                queue.shift();
                return { status: "already_processed" };
            });

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 1, stopped: false });
            expect(repository.applyEventResult.mock.calls.map((c) => c[0].eventId)).toEqual(["e1", "e2"]);
        });

        it("stops, leaving the event for the next run, when new events appeared mid-processing", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({ queue: [e1] });
            repository.applyEventResult.mockResolvedValueOnce({ status: "events_changed" });

            const summary = await service.processDueEvents(NOW);

            expect(summary).toEqual({ processed: 0, stopped: true });
            expect(repository.applyEventResult).toHaveBeenCalledTimes(1);
        });

        it("stops, leaving the event for the next run, when a client's open item changed mid-processing", async () => {
            const e1 = event({ id: "e1", date: "2026-11-10" });
            const { service, repository } = makeProcessor({ queue: [e1] });
            repository.applyEventResult.mockResolvedValueOnce({ status: "items_changed" });

            await expect(service.processDueEvents(NOW)).resolves.toEqual({ processed: 0, stopped: true });
        });

        it("F1: lists the whole queue once, past the per-run cap, and every event sees all later ones", async () => {
            const queue = Array.from({ length: 1001 }, (_, i) =>
                event({ id: `e${String(i).padStart(4, "0")}`, date: "2026-11-10", createdAt: new Date(OLD.getTime() + i) }),
            );
            const { service, repository } = makeProcessor({ queue });

            const summary = await service.processDueEvents(NOW);

            // Progress: a capped run processes some events and is not a stop.
            expect(summary.processed).toBeGreaterThan(0);
            expect(summary.stopped).toBe(false);
            expect(repository.listUnprocessedEvents).toHaveBeenCalledTimes(1);
            const first = repository.applyEventResult.mock.calls[0]![0];
            expect(first.expectedUnprocessedEventIds).toHaveLength(1001);
            // The next run continues where this one stopped.
            const second = await service.processDueEvents(NOW);
            expect(second.processed).toBeGreaterThan(0);
            expect(repository.applyEventResult.mock.calls.length).toBe(summary.processed + second.processed);
        });

        it("stops when the queue cannot be listed", async () => {
            const { service, repository } = makeProcessor();
            repository.listUnprocessedEvents.mockRejectedValueOnce(new Error("db down"));

            await expect(service.processDueEvents(NOW)).resolves.toEqual({ processed: 0, stopped: true });
        });
    });

    describe("processScheduled", () => {
        it("does nothing without the scheduler lease", async () => {
            const { service, repository, lease } = makeProcessor({ holdsLease: false });

            await service.processScheduled();

            expect(lease.holdsLease).toHaveBeenCalled();
            expect(repository.listUnprocessedEvents).not.toHaveBeenCalled();
        });

        it("runs with the lease and never throws", async () => {
            const { service, repository } = makeProcessor();
            repository.listUnprocessedEvents.mockRejectedValue(new Error("boom"));

            await expect(service.processScheduled()).resolves.toBeUndefined();
            expect(repository.listUnprocessedEvents).toHaveBeenCalled();
        });
    });
});
