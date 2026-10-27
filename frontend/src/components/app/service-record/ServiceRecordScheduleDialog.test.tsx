import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { adminServiceRecordEditApi } from "@/features/service-records/api/admin-service-record-edit.api";
import { publishServiceRecordRevisionSync } from "@/features/service-records/revision-sync";
import { AdminServiceRecordEditApiError, type AdminServiceRecordEditState } from "@/features/service-records/types";

import type { AdminServiceRecordEditorOverview } from "./ServiceRecordAdminWizard";
import { ServiceRecordScheduleDialog } from "./ServiceRecordScheduleDialog";

jest.mock("@/hooks/useBusinessDayCalendar");

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
}));
jest.mock("@/features/service-records/revision-sync", () => ({
    publishServiceRecordRevisionSync: jest.fn(),
}));

type PreviewResult = Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>;
type ConfirmResult = Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>;

/** N = 10, start 2026-12-14, Saturday / Sunday / holiday off (12-25 is a holiday). */
const FIXTURE_DATES = [
    "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
    "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28",
];
// The backend's concurrent-write code: the only 409 the dialog retries.
const WRITE_TARGET_CHANGED = "SERVICE_RECORD_WRITE_TARGET_CHANGED";
const OFF = { saturday: false, sunday: false, holiday: false };

function overviewOf(dates: string[], writtenSessions: number[]): AdminServiceRecordEditorOverview {
    return {
        record: {
            id: "case-1",
            status: "ACTIVE",
            startDate: dates[0],
            endDate: dates[dates.length - 1],
            totalSessions: dates.length,
            header: null,
            sessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                locked: writtenSessions.includes(index + 1),
                submittedAt: null,
                updatedAt: "2026-12-01T00:00:00.000Z",
                answers: {},
            })),
        },
        assignments: [],
        scheduleProjection: {
            entries: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: "assignment-1",
                scheduleId: 1,
                employeeId: 1,
                provenanceVersion: "p-1",
            })),
            blockingReasons: [],
        },
        serviceDays: OFF,
    } as unknown as AdminServiceRecordEditorOverview;
}

let sourceFingerprint = "source-1";
let existingDraft: Record<string, unknown> | null = null;
let startedChanges: Record<string, unknown> = {};
let lastSchedule: { serviceDays: unknown; dates: string[] } | undefined;

const asState = (value: unknown) => value as AdminServiceRecordEditState;

function draftOf(id: string, draftVersion: number, changes: Record<string, unknown> = {}) {
    return {
        id,
        branchId: "branch-1",
        serviceRecordCaseId: "case-1",
        sourceCaseVersion: 1,
        sourceFingerprint,
        sourceSnapshot: {},
        changes,
        draftVersion,
        status: "ACTIVE",
        createdByUserId: "admin-1",
        updatedByUserId: "admin-1",
        discardedByUserId: null,
        createdAt: "2026-12-01T00:00:00.000Z",
        updatedAt: "2026-12-01T00:00:00.000Z",
        discardedAt: null,
    };
}

function identity() {
    return { sourceChanged: false, sourceCaseVersion: 1, sourceFingerprint };
}

const originalFetch = global.fetch;

function mockOverview(overview: AdminServiceRecordEditorOverview) {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => overview });
}

function installApi() {
    const getDraft = jest.spyOn(adminServiceRecordEditApi, "getDraft")
        .mockImplementation(async () => asState({ ...identity(), draft: existingDraft }));
    const discardDraft = jest.spyOn(adminServiceRecordEditApi, "discardDraft")
        .mockImplementation(async () => asState({ ...identity(), draft: null }));
    const startDraft = jest.spyOn(adminServiceRecordEditApi, "startDraft")
        .mockImplementation(async () => asState({ ...identity(), draft: draftOf("draft-1", 1, startedChanges) }));
    const updateDraft = jest.spyOn(adminServiceRecordEditApi, "updateDraft")
        .mockImplementation(async (_id, version, _changes, _move, schedule) => {
            lastSchedule = schedule as typeof lastSchedule;
            return asState({ ...identity(), draft: draftOf("draft-1", version + 1) });
        });
    const previewDraft = jest.spyOn(adminServiceRecordEditApi, "previewDraft")
        .mockImplementation(async (id, version) => ({
            previewId: "preview-1",
            draftId: id,
            draftVersion: version,
            blockingReasons: [],
            after: {
                sessions: (lastSchedule?.dates ?? []).map((serviceDate, index) => ({ sessionIndex: index + 1, serviceDate })),
            },
        }) as unknown as PreviewResult);
    const confirmDraft = jest.spyOn(adminServiceRecordEditApi, "confirmDraft")
        .mockResolvedValue({ status: "confirmed", caseId: "case-1", caseVersion: 2 } as unknown as ConfirmResult);
    return { getDraft, discardDraft, startDraft, updateDraft, previewDraft, confirmDraft };
}

function renderDialog(props: Partial<React.ComponentProps<typeof ServiceRecordScheduleDialog>> = {}) {
    const onOpenChange = jest.fn();
    const onSaved = jest.fn();
    const view = render(
        <ServiceRecordScheduleDialog
            open
            onOpenChange={onOpenChange}
            clientId={42}
            clientName="김하늘"
            onSaved={onSaved}
            {...props}
        />,
    );
    return { ...view, onOpenChange, onSaved };
}

async function renderReady(props: Partial<React.ComponentProps<typeof ServiceRecordScheduleDialog>> = {}) {
    const rendered = renderDialog(props);
    await waitFor(() => expect(progress()).not.toBeNull());
    return rendered;
}

function dayButton(iso: string): HTMLButtonElement {
    const element = document.querySelector<HTMLButtonElement>(`button[data-slot="day"][data-date="${iso}"]`);
    if (!element) throw new Error(`no day button ${iso}`);
    return element;
}

function progress(): string | null {
    return document.querySelector('[data-component$="_section-calendar_progress"]')?.textContent ?? null;
}

// Not by name: while saving the button shows a spinner instead of 저장.
const saveButton = () => {
    const button = document.querySelector<HTMLButtonElement>('button[data-component$="_actions_save"]');
    if (!button) throw new Error("no save button");
    return button;
};
const click = (iso: string) => fireEvent.click(dayButton(iso));

/** Deselect 12-17 and pick 12-29: the smallest valid edit of the fixture. */
function editFixture() {
    click("2026-12-17");
    click("2026-12-29");
}
const EDITED_DATES = [
    "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-18", "2026-12-21",
    "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28", "2026-12-29",
];

async function saveEdited() {
    editFixture();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
}

describe("ServiceRecordScheduleDialog", () => {
    let api: ReturnType<typeof installApi>;

    beforeEach(() => {
        sourceFingerprint = "source-1";
        existingDraft = null;
        startedChanges = {};
        lastSchedule = undefined;
        mockToast.mockClear();
        jest.mocked(publishServiceRecordRevisionSync).mockClear();
        mockOverview(overviewOf(FIXTURE_DATES, [1, 3]));
        api = installApi();
    });
    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    describe("picking dates (fixture: N=10, written sessions 1 and 3)", () => {
        it("opens on the first editable month with the title, the client and the count", async () => {
            await renderReady();

            expect(screen.getAllByText("제공기록지 일정 변경").length).toBeGreaterThan(0);
            expect(screen.getByText(/김하늘 · 시작일 2026-12-14/)).toBeInTheDocument();
            expect(screen.getByText("2026년 12월")).toBeInTheDocument();
            expect(progress()).toBe("10/10");
            expect(saveButton()).toBeEnabled();
            // Nothing is written just by opening it.
            expect(api.startDraft).not.toHaveBeenCalled();
            expect(api.updateDraft).not.toHaveBeenCalled();
        });

        it("cannot deselect a written session or anything before it, and cannot add anything before 12-16", async () => {
            await renderReady();

            for (const iso of ["2026-12-14", "2026-12-15", "2026-12-16"]) {
                expect(dayButton(iso)).toHaveAttribute("data-state", "fixed");
                click(iso);
                expect(dayButton(iso)).toHaveAttribute("aria-pressed", "true");
            }
            expect(await screen.findByText("작성된 회차는 바꿀 수 없어요")).toBeInTheDocument();
            expect(progress()).toBe("10/10");

            for (let day = 1; day <= 16; day += 1) {
                const iso = `2026-12-${String(day).padStart(2, "0")}`;
                const button = dayButton(iso);
                expect(button.disabled || button.getAttribute("data-state") === "fixed").toBe(true);
            }
        });

        it("deselecting 12-17 leaves 9/10 with save disabled, and picking 12-29 makes 10/10 with save enabled", async () => {
            await renderReady();

            click("2026-12-17");
            expect(progress()).toBe("9/10");
            expect(dayButton("2026-12-17")).toHaveAttribute("aria-pressed", "false");
            expect(saveButton()).toBeDisabled();

            click("2026-12-29");
            expect(progress()).toBe("10/10");
            expect(dayButton("2026-12-29")).toHaveAttribute("aria-pressed", "true");
            expect(saveButton()).toBeEnabled();
        });

        it("refuses an eleventh date with the full notice and changes nothing", async () => {
            await renderReady();

            click("2026-12-30");

            expect(await screen.findByText("이미 10회차를 모두 골랐어요. 먼저 빼고 싶은 날짜를 눌러 주세요.")).toBeInTheDocument();
            expect(progress()).toBe("10/10");
            expect(dayButton("2026-12-30")).toHaveAttribute("aria-pressed", "false");
        });

        it("turning Saturday on makes 12-19 a left-out day that can be picked", async () => {
            await renderReady();
            expect(dayButton("2026-12-19")).toHaveAttribute("data-state", "unavailable");
            expect(dayButton("2026-12-19")).toBeDisabled();

            fireEvent.click(screen.getByRole("switch", { name: "토요일 서비스" }));

            expect(dayButton("2026-12-19")).toHaveAttribute("data-state", "skipped");
            expect(dayButton("2026-12-19")).toBeEnabled();
            // The weekend is still closed.
            expect(dayButton("2026-12-20")).toHaveAttribute("data-state", "unavailable");

            click("2026-12-17");
            click("2026-12-19");
            expect(progress()).toBe("10/10");
            expect(dayButton("2026-12-19")).toHaveAttribute("aria-pressed", "true");
            expect(saveButton()).toBeEnabled();
        });

        it("tells which dates a switch took away", async () => {
            mockOverview({ ...overviewOf([
                "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
                "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24",
            ], [1]), serviceDays: { ...OFF, saturday: true } } as AdminServiceRecordEditorOverview);
            await renderReady();
            expect(progress()).toBe("10/10");

            fireEvent.click(screen.getByRole("switch", { name: "토요일 서비스" }));

            expect(await screen.findByText("12/19은(는) 이제 고를 수 없어서 뺐어요.")).toBeInTheDocument();
            expect(progress()).toBe("9/10");
            expect(saveButton()).toBeDisabled();
        });

        it("되돌리기 restores the dates and the switches", async () => {
            await renderReady();
            editFixture();
            fireEvent.click(screen.getByRole("switch", { name: "일요일 서비스" }));
            expect(screen.getByRole("switch", { name: "일요일 서비스" })).toBeChecked();

            fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));

            expect(screen.getByRole("switch", { name: "일요일 서비스" })).not.toBeChecked();
            expect(dayButton("2026-12-17")).toHaveAttribute("aria-pressed", "true");
            expect(dayButton("2026-12-29")).toHaveAttribute("aria-pressed", "false");
            expect(progress()).toBe("10/10");
        });

        it("취소 closes without writing anything", async () => {
            const { onOpenChange } = await renderReady();
            editFixture();

            fireEvent.click(screen.getByRole("button", { name: "취소" }));

            expect(onOpenChange).toHaveBeenCalledWith(false);
            expect(api.startDraft).not.toHaveBeenCalled();
            expect(api.updateDraft).not.toHaveBeenCalled();
            expect(api.confirmDraft).not.toHaveBeenCalled();
        });

        it("keeps save enabled when a written session sits on a Saturday the schedule has turned off", async () => {
            mockOverview(overviewOf([
                "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
                "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24",
            ], [1, 6]));
            await renderReady();

            expect(progress()).toBe("10/10");
            expect(dayButton("2026-12-19")).toHaveAttribute("data-state", "fixed");
            expect(saveButton()).toBeEnabled();
        });

        it("moves between months with the arrows and stops at the start month", async () => {
            await renderReady();
            expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();

            fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
            expect(screen.getByText("2027년 1월")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "이전 달" })).toBeEnabled();

            fireEvent.click(screen.getByRole("button", { name: "이전 달" }));
            expect(screen.getByText("2026년 12월")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
        });
    });

    describe("loading", () => {
        it("shows a retryable error when the editor cannot be read", async () => {
            global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
                .mockResolvedValue({ ok: true, json: async () => overviewOf(FIXTURE_DATES, [1, 3]) });
            renderDialog();

            expect(await screen.findByText("일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
            fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

            await waitFor(() => expect(progress()).toBe("10/10"));
        });

        it("refuses to edit a schedule the server cannot project", async () => {
            const blocked = overviewOf(FIXTURE_DATES, [1, 3]);
            (blocked as unknown as { scheduleProjection: { blockingReasons: unknown[] } }).scheduleProjection.blockingReasons = [
                { code: "ASSIGNMENT_RANGE_OVERLAP", message: "겹침" },
            ];
            mockOverview(blocked);
            renderDialog();

            expect(await screen.findByText("서비스 일정을 확인할 수 없어 변경할 수 없어요.")).toBeInTheDocument();
            expect(document.querySelector('button[data-slot="day"]')).toBeNull();
        });

        it("retries the read when the case changed in the middle of it", async () => {
            let reads = 0;
            api.getDraft.mockImplementation(async () => {
                reads += 1;
                // The first attempt's two reads straddle a change; later reads agree.
                if (reads === 2) sourceFingerprint = "source-2";
                return asState({ ...identity(), draft: null });
            });
            renderDialog();

            await waitFor(() => expect(progress()).toBe("10/10"));
            expect(reads).toBe(4);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe("saving", () => {
        it("calls getDraft, discards an active draft, then startDraft, updateDraft, previewDraft and confirmDraft in that order", async () => {
            existingDraft = draftOf("old-draft", 3);
            await renderReady();

            await saveEdited();
            await waitFor(() => expect(api.confirmDraft).toHaveBeenCalledTimes(1));

            const calls = [
                api.getDraft.mock.invocationCallOrder.at(-1),
                api.discardDraft.mock.invocationCallOrder[0],
                api.startDraft.mock.invocationCallOrder[0],
                api.updateDraft.mock.invocationCallOrder[0],
                api.previewDraft.mock.invocationCallOrder[0],
                api.confirmDraft.mock.invocationCallOrder[0],
            ];
            expect(calls.every((order) => typeof order === "number")).toBe(true);
            expect(calls).toEqual([...calls].sort((left, right) => (left as number) - (right as number)));
            expect(new Set(calls).size).toBe(6);

            expect(api.discardDraft).toHaveBeenCalledWith("old-draft", 3);
            expect(api.updateDraft).toHaveBeenCalledWith("draft-1", 1, {}, undefined, {
                serviceDays: OFF,
                dates: EDITED_DATES,
            });
            expect(api.previewDraft).toHaveBeenCalledWith("draft-1", 2);
            expect(api.confirmDraft).toHaveBeenCalledWith("draft-1", 2, "preview-1", expect.any(String));
        });

        it("sends the switches the admin chose", async () => {
            await renderReady();
            fireEvent.click(screen.getByRole("switch", { name: "토요일 서비스" }));
            click("2026-12-17");
            click("2026-12-19");
            await waitFor(() => expect(saveButton()).toBeEnabled());

            fireEvent.click(saveButton());
            await waitFor(() => expect(api.updateDraft).toHaveBeenCalledTimes(1));

            expect(api.updateDraft).toHaveBeenCalledWith("draft-1", 1, {}, undefined, {
                serviceDays: { saturday: true, sunday: false, holiday: false },
                dates: [
                    "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-18", "2026-12-19",
                    "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28",
                ],
            });
        });

        it("closes, refreshes and announces after a successful save", async () => {
            const { onOpenChange, onSaved } = await renderReady();

            await saveEdited();

            await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
            await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
            expect(publishServiceRecordRevisionSync).toHaveBeenCalledWith({ caseId: "case-1", caseVersion: 2 });
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                variant: "success",
                description: "10회차 서비스 제공일을 저장했어요.",
            }));
            expect(api.discardDraft).not.toHaveBeenCalled();
        });

        it("reloads with a message and writes nothing when the source identity changed", async () => {
            await renderReady();
            editFixture();
            sourceFingerprint = "source-2";

            fireEvent.click(saveButton());

            expect(await screen.findByText("일정이 바뀌어 다시 불러왔어요")).toBeInTheDocument();
            expect(api.startDraft).not.toHaveBeenCalled();
            expect(api.updateDraft).not.toHaveBeenCalled();
            expect(api.confirmDraft).not.toHaveBeenCalled();
            // The edit was thrown away with the stale source.
            expect(progress()).toBe("10/10");
            expect(dayButton("2026-12-17")).toHaveAttribute("aria-pressed", "true");
        });

        it("reloads without touching a draft that started on a different source", async () => {
            await renderReady();
            editFixture();
            api.startDraft.mockImplementation(async () => {
                sourceFingerprint = "source-2";
                return asState({ ...identity(), draft: draftOf("draft-1", 1) });
            });

            fireEvent.click(saveButton());

            expect(await screen.findByText("일정이 바뀌어 다시 불러왔어요")).toBeInTheDocument();
            expect(api.updateDraft).not.toHaveBeenCalled();
        });

        it("aborts without updating a draft that already holds changes", async () => {
            startedChanges = { sessions: [{ sessionIndex: 2 }] };
            await renderReady();

            await saveEdited();

            expect(await screen.findByText(/다른 화면에서 수정 중인 내용이 있어 저장하지 않았어요/)).toBeInTheDocument();
            expect(api.startDraft).toHaveBeenCalledTimes(1);
            expect(api.updateDraft).not.toHaveBeenCalled();
            expect(api.previewDraft).not.toHaveBeenCalled();
            expect(api.confirmDraft).not.toHaveBeenCalled();
            expect(api.discardDraft).not.toHaveBeenCalled();
        });

        it("retries a version conflict on confirm exactly once and then succeeds", async () => {
            api.confirmDraft
                .mockRejectedValueOnce(new AdminServiceRecordEditApiError(409, { code: WRITE_TARGET_CHANGED }))
                .mockResolvedValue({ status: "confirmed", caseId: "case-1", caseVersion: 3 } as unknown as ConfirmResult);
            const { onOpenChange } = await renderReady();

            await saveEdited();

            await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
            expect(api.confirmDraft).toHaveBeenCalledTimes(2);
            expect(api.startDraft).toHaveBeenCalledTimes(2);
            expect(api.updateDraft).toHaveBeenCalledTimes(2);
            expect(publishServiceRecordRevisionSync).toHaveBeenCalledWith({ caseId: "case-1", caseVersion: 3 });
        });

        it("gives up after the single retry when the conflict persists", async () => {
            api.confirmDraft.mockRejectedValue(new AdminServiceRecordEditApiError(409, { code: WRITE_TARGET_CHANGED }));
            const { onOpenChange } = await renderReady();

            await saveEdited();

            expect(await screen.findByText(/다른 화면에서 일정이 바뀌어 저장하지 못했어요/)).toBeInTheDocument();
            expect(api.confirmDraft).toHaveBeenCalledTimes(2);
            expect(onOpenChange).not.toHaveBeenCalledWith(false);
            expect(saveButton()).toBeEnabled();
        });

        it("does not retry a conflict that names its blocking reasons", async () => {
            api.confirmDraft.mockRejectedValue(new AdminServiceRecordEditApiError(409, {
                code: WRITE_TARGET_CHANGED,
                blockingReasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3 }],
            }));
            await renderReady();

            await saveEdited();

            expect(await screen.findByText(/그사이 작성된 회차가 있어 날짜를 바꿀 수 없어요/)).toBeInTheDocument();
            expect(api.confirmDraft).toHaveBeenCalledTimes(1);
            expect(api.startDraft).toHaveBeenCalledTimes(1);
            expect(api.discardDraft).toHaveBeenCalledWith("draft-1", 2);
        });

        it("does not retry a conflict caused by a running follow-up job", async () => {
            api.confirmDraft.mockRejectedValue(new AdminServiceRecordEditApiError(409, {
                code: WRITE_TARGET_CHANGED,
                blockingOperation: { operation: "record_snapshot" },
            }));
            await renderReady();

            await saveEdited();

            expect(await screen.findByText(/후속 작업이 아직 진행 중/)).toBeInTheDocument();
            expect(api.confirmDraft).toHaveBeenCalledTimes(1);
        });

        it("reloads instead of retrying when the source moved during the failed confirm", async () => {
            api.confirmDraft.mockImplementationOnce(async () => {
                sourceFingerprint = "source-2";
                throw new AdminServiceRecordEditApiError(409, { code: WRITE_TARGET_CHANGED });
            });
            await renderReady();

            await saveEdited();

            expect(await screen.findByText("일정이 바뀌어 다시 불러왔어요")).toBeInTheDocument();
            expect(api.confirmDraft).toHaveBeenCalledTimes(1);
            expect(api.startDraft).toHaveBeenCalledTimes(1);
        });

        it.each([
            ["REQUEST_NOT_PENDING", { code: "REQUEST_NOT_PENDING" }],
            ["REQUEST_STALE", { code: "REQUEST_STALE" }],
            ["a bare REQUEST_CONFLICT", { code: "REQUEST_CONFLICT" }],
            ["a 409 without a code", {}],
            ["an unknown code", { code: "SOMETHING_ELSE" }],
        ])("confirms only once and shows the error for %s", async (_label, body) => {
            api.confirmDraft.mockRejectedValue(new AdminServiceRecordEditApiError(409, body));
            const { onOpenChange } = await renderReady();

            await saveEdited();

            expect(await screen.findByText(/다른 화면에서 일정이 바뀌어 저장하지 못했어요/)).toBeInTheDocument();
            expect(api.confirmDraft).toHaveBeenCalledTimes(1);
            expect(api.startDraft).toHaveBeenCalledTimes(1);
            expect(onOpenChange).not.toHaveBeenCalledWith(false);
        });

        it("shows the Korean message for the preview's blocking reasons and discards the draft", async () => {
            api.previewDraft.mockImplementation(async (id, version) => ({
                previewId: "preview-1",
                draftId: id,
                draftVersion: version,
                blockingReasons: [{ code: "NON_SERVICE_DAY", message: "raw upstream text", sessionIndex: 4 }],
                after: { sessions: [] },
            }) as unknown as PreviewResult);
            await renderReady();

            await saveEdited();

            expect(await screen.findByText(/서비스일이 아닌 날짜가 있어요/)).toBeInTheDocument();
            expect(screen.queryByText(/raw upstream text/)).toBeNull();
            expect(api.confirmDraft).not.toHaveBeenCalled();
            expect(api.discardDraft).toHaveBeenCalledWith("draft-1", 2);
        });

        it("shows the Korean message for a schedule code and discards the draft", async () => {
            api.updateDraft.mockRejectedValue(new AdminServiceRecordEditApiError(400, {
                code: "VALIDATION_FAILED",
                message: "raw upstream text",
                scheduleCode: "SCHEDULE_COUNT_MISMATCH",
            }));
            await renderReady();

            await saveEdited();

            expect(await screen.findByText("선택한 날짜 수가 회차 수와 달라요.")).toBeInTheDocument();
            expect(screen.queryByText(/raw upstream text/)).toBeNull();
            expect(api.previewDraft).not.toHaveBeenCalled();
            expect(api.discardDraft).toHaveBeenCalledWith("draft-1", 1);
        });

        it("refuses to confirm a preview that planned other dates than the chosen ones", async () => {
            api.previewDraft.mockImplementation(async (id, version) => ({
                previewId: "preview-1",
                draftId: id,
                draftVersion: version,
                blockingReasons: [],
                after: { sessions: FIXTURE_DATES.map((serviceDate, index) => ({ sessionIndex: index + 1, serviceDate })) },
            }) as unknown as PreviewResult);
            await renderReady();

            await saveEdited();

            expect(await screen.findByText(/저장할 일정을 확인하지 못했어요/)).toBeInTheDocument();
            expect(api.confirmDraft).not.toHaveBeenCalled();
            expect(api.discardDraft).toHaveBeenCalledWith("draft-1", 2);
        });

        it("does not start a second save while one is running", async () => {
            let release!: () => void;
            api.confirmDraft.mockImplementation(() => new Promise<ConfirmResult>((resolve) => {
                release = () => resolve({ status: "confirmed", caseId: "case-1", caseVersion: 2 } as unknown as ConfirmResult);
            }));
            const { onOpenChange } = await renderReady();

            await saveEdited();
            await waitFor(() => expect(api.confirmDraft).toHaveBeenCalledTimes(1));
            expect(saveButton()).toBeDisabled();
            fireEvent.click(screen.getByRole("button", { name: "취소" }));
            expect(onOpenChange).not.toHaveBeenCalled();

            await act(async () => { release(); });
            await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
            expect(api.startDraft).toHaveBeenCalledTimes(1);
        });
    });
});
