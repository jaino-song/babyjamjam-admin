/**
 * Behavior contract for the administrator service-record editor
 * (ServiceRecordAdminWizard).
 *
 * Seam: the real wizard with the draft API, the branch calendar hook and
 * `fetch` (overview refresh) mocked. These tests pin what an administrator can
 * do and which calls reach the draft API, not how the controls are built:
 * elements are found by role, accessible name, label text or visible text.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { getServiceRecordHeaderFieldError } from "@babyjamjam/service-record-ui";
import { ServiceRecordAdminWizard } from "@/components/app/service-record/ServiceRecordAdminWizard";
import { adminServiceRecordEditApi } from "@/features/service-records/api/admin-service-record-edit.api";
import type { AdminServiceRecordEditChanges } from "@/features/service-records/types";

import {
    CLIENT_ID,
    DATES,
    EDITOR_URL,
    HEADER,
    NOW,
    PREVIEW_ID,
    STORED_SIGNATURE,
    confirmResult,
    makeDraftState,
    makePreview,
    noDraftState,
    overview,
} from "./service-record-admin-flow.fixtures";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/features/service-records/api/admin-service-record-edit.api", () => ({
    adminServiceRecordEditApi: {
        getDraft: jest.fn(),
        startDraft: jest.fn(),
        updateDraft: jest.fn(),
        previewDraft: jest.fn(),
        confirmDraft: jest.fn(),
        discardDraft: jest.fn(),
    },
}));

// The rebuilt UI must keep these strings (Phase 3 brief input).
const PINNED_COPY = {
    /** Step title of a session's review page. */
    reviewTitle: "기록 내용 확인",
    back: "이전",
    /** Overview action that opens the basic-information editor. */
    headerEdit: "기본정보 수정",
    /** Keeps a changed basic-information form or session in the browser (nothing is sent yet). */
    keepChange: "수정 확인",
    /** Overview action that sends every kept edit; the preview dialog's approval button has the same name. */
    commit: "수정 확정",
    previewDialog: "초안 변경 미리보기",
    /** The preview's content-change summary: one line for the basic information, one for the changed sessions. */
    previewHeader: (changed: boolean) => `기본정보: ${changed ? "변경됨" : "변경 없음"}`,
    previewSessions: (sessionIndexes: number[]) =>
        `기록 회차: ${sessionIndexes.length > 0 ? sessionIndexes.map((index) => `${index}회차`).join(", ") : "변경 없음"}`,
    /** The preview lists each session's date as YYYY.MM.DD. */
    previewDate: (isoDate: string) => isoDate.replaceAll("-", "."),
    /** Moves to the review after a session input page. */
    next: "다음",
    /** The read-only signature image and its empty state. */
    signatureImage: "산모 서명",
    signatureMissing: "저장된 서명이 없어요",
    /** Admin service-date edit button (invisible accessible name). */
    dateEdit: "제공일 수정",
    dateDialog: (sessionIndex: number) => `${sessionIndex}회차 서비스 제공일 수정`,
    dateApply: "수정",
    followDialog: "뒷 회차들도 변경할까요?",
    followApply: "변경하기",
};

const HEADER_LABELS = {
    momName: "산모 성명",
    momBirth: "산모 생년월일",
    babyName: "신생아 성명",
    babyBirth: "신생아 출생일자",
    babyWeight: "신생아 몸무게 (kg)",
};
const DELIVERY_LABEL = "분만형태";

/** Only Date is faked: waitFor and the wizard's async saves need real timers. */
const FAKE_DATE_ONLY = [
    "nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout",
    "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
    "hrtime", "performance",
] as const;

/**
 * A day card is identified by its service date, never by its session number or
 * status words (a card may also show unrelated numbers such as "담당자 1명").
 * The date is matched in any of the formats below so the rebuilt UI can choose one.
 */
// The rebuilt UI's day card accessible name must contain the service date in one of these formats (Phase 3 brief input).
const dayCardByDate = (isoDate: string) => {
    const [year, month, day] = isoDate.split("-").map(Number);
    const m = `0?${month}`;
    const d = `0?${day}`;
    const formats = [
        `${year}[.-]${m}[.-]${d}`, // 2026.09.21, 2026-09-21
        `${m}/${d}`, // 9/21, 09/21
        `${m}\\.${d}`, // 9.21, 09.21
        `${m}월\\s*${d}일`, // 9월 21일
    ];
    return { name: new RegExp(`(?<!\\d)(?:${formats.join("|")})(?!\\d)`) };
};
const dayCard = (sessionIndex: number) => dayCardByDate(DATES[sessionIndex - 1]);

/** An RFC 4122 UUID (versions 1-5), the shape the confirm DTO's isUuid check accepts. */
const UUID = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const decoration = /^[✓●]\s*/;

/**
 * The semantic container (group, radiogroup or region) with exactly this
 * accessible name. It throws when there is none, so a lookup never widens to the
 * whole screen.
 */
function scoped(name: string): ReturnType<typeof within> {
    const named = [
        ...screen.queryAllByRole("radiogroup", { name }),
        ...screen.queryAllByRole("group", { name }),
        ...screen.queryAllByRole("region", { name }),
    ];
    if (named.length !== 1) throw new Error(`expected exactly one group, radiogroup or region named "${name}", found ${named.length}`);
    return within(named[0]);
}

/**
 * Chooses one option of an item. The item's group name is required: the option is
 * looked up inside that group as radio, then checkbox, then button, and the call
 * throws when the group is missing.
 */
function chooseOption(groupName: string, optionText: string) {
    const root = scoped(groupName);
    for (const role of ["radio", "checkbox", "button"] as const) {
        const found = root.queryAllByRole(role, {
            name: (accessibleName: string) => accessibleName.replace(decoration, "").trim() === optionText,
        });
        if (found.length > 1) throw new Error(`option "${optionText}" is ambiguous in "${groupName}" (${found.length} ${role}s)`);
        if (found.length === 1) {
            fireEvent.click(found[0]);
            return;
        }
    }
    throw new Error(`option "${optionText}" not found in "${groupName}" as radio, checkbox or button`);
}

function renderWizard(props: Partial<React.ComponentProps<typeof ServiceRecordAdminWizard>> = {}) {
    return render(
        <ServiceRecordAdminWizard
            clientId={CLIENT_ID}
            overview={overview}
            initialDraftState={noDraftState()}
            {...props}
        />,
    );
}

/**
 * Content and date moves reach the server only on 수정 확정:
 * getDraft -> (discardDraft) -> startDraft(content) -> updateDraft per date move -> previewDraft -> confirmDraft.
 * The wizard checks the draft it gets back against what it sent, so the mocks
 * store (echo) what they receive, as the real server does.
 */
let sentChanges: AdminServiceRecordEditChanges = {};
let movedDates: Record<number, string> = {};

function echoedDraft(draftVersion: number, withMoves: boolean) {
    const sessions = new Map((sentChanges.sessions ?? []).map((session) => [session.sessionIndex, { ...session }]));
    if (withMoves) {
        for (const [index, serviceDate] of Object.entries(movedDates)) {
            sessions.set(Number(index), { ...sessions.get(Number(index)), sessionIndex: Number(index), serviceDate });
        }
    }
    return makeDraftState({
        ...(sentChanges.header ? { header: sentChanges.header } : {}),
        ...(sessions.size ? { sessions: [...sessions.values()] } : {}),
    }, draftVersion);
}

/** Echoing draft API; `moved` is the date every session ends on after the scripted date moves. */
function scriptCommit(contentChanges: { headerChanged: boolean; changedSessionIndexes: number[] }, moved: Record<number, string> = {}) {
    sentChanges = {};
    movedDates = moved;
    const previewDraftVersion = 1 + (Object.keys(moved).length > 0 ? 1 : 0);
    jest.mocked(adminServiceRecordEditApi.startDraft).mockImplementation(async (_clientId, changes) => {
        sentChanges = changes ?? {};
        return echoedDraft(1, false);
    });
    jest.mocked(adminServiceRecordEditApi.updateDraft).mockImplementation(async (_draftId, version) => echoedDraft(version + 1, true));
    jest.mocked(adminServiceRecordEditApi.discardDraft).mockResolvedValue(noDraftState());
    const basePreview = makePreview(contentChanges, previewDraftVersion);
    const preview = Object.keys(moved).length === 0
        ? basePreview
        : {
            ...basePreview,
            after: {
                ...basePreview.after,
                startDate: moved[1] ?? basePreview.after.startDate,
                endDate: moved[3] ?? basePreview.after.endDate,
                sessions: basePreview.after.sessions.map((entry) => ({ ...entry, serviceDate: moved[entry.sessionIndex] ?? entry.serviceDate })),
            },
        };
    jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue(
        preview as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>,
    );
    jest.mocked(adminServiceRecordEditApi.confirmDraft).mockResolvedValue(
        confirmResult as Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>,
    );
}

/** 수정 확정 on the overview, then wait for the preview dialog. */
async function startCommit() {
    fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.commit }));
    return screen.findByRole("dialog", { name: PINNED_COPY.previewDialog });
}

describe("service-record admin editor contract", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW, doNotFake: [...FAKE_DATE_ONLY] });
        for (const call of Object.values(adminServiceRecordEditApi)) jest.mocked(call).mockReset();
        jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue(noDraftState());
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => overview }) as unknown as typeof fetch;
    });

    afterEach(() => {
        jest.useRealTimers();
        global.fetch = originalFetch;
    });

    describe("overview and read-only signature", () => {
        it("7. opens on the overview with one card per session and no write", () => {
            renderWizard();

            expect(screen.getByRole("button", dayCard(1))).toBeEnabled();
            expect(screen.getByRole("button", dayCard(2))).toBeEnabled();
            expect(screen.getByRole("button", dayCard(3))).toBeEnabled();
            expect(screen.getByRole("button", { name: PINNED_COPY.headerEdit })).toBeInTheDocument();
            expect(screen.queryByText(PINNED_COPY.reviewTitle)).not.toBeInTheDocument();
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        });

        it("7. a session with a stored signature shows it read-only on the review", () => {
            renderWizard();

            fireEvent.click(screen.getByRole("button", dayCard(1)));

            expect(screen.getByText(PINNED_COPY.reviewTitle)).toBeInTheDocument();
            expect(screen.getByRole("img", { name: PINNED_COPY.signatureImage })).toHaveAttribute("src", STORED_SIGNATURE);
        });

        it("7. a session without a signature says so instead of showing one", () => {
            renderWizard();

            fireEvent.click(screen.getByRole("button", dayCard(2)));

            expect(screen.getByText(PINNED_COPY.reviewTitle)).toBeInTheDocument();
            expect(screen.getByText(PINNED_COPY.signatureMissing)).toBeInTheDocument();
            expect(screen.queryByRole("img", { name: PINNED_COPY.signatureImage })).not.toBeInTheDocument();
        });

        it("7. leaving a session without changes returns to the overview and writes nothing", () => {
            renderWizard();
            fireEvent.click(screen.getByRole("button", dayCard(1)));

            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.back }));

            expect(screen.getByRole("button", dayCard(3))).toBeInTheDocument();
            expect(screen.queryByText(PINNED_COPY.reviewTitle)).not.toBeInTheDocument();
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
        });
    });

    describe("session edit, preview and confirm", () => {
        it("8. an edited session answer is kept in the browser, then sent on 수정 확정 and confirmed with the preview's ids", async () => {
            // An ACTIVE draft left by an earlier session must be discarded before the new one starts.
            const leftover = makeDraftState({ header: { momName: "기존 수정 산모" } }, 2);
            jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue(leftover);
            scriptCommit({ headerChanged: false, changedSessionIndexes: [1] });
            renderWizard();

            fireEvent.click(screen.getByRole("button", dayCard(1)));
            fireEvent.click(screen.getByRole("button", { name: "산모 수정" }));
            chooseOption("④ 좌욕", "미실시");
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.next }));
            expect(within(scoped("산모").getByRole("group", { name: "④ 좌욕" })).getByText(/미실시/)).toBeInTheDocument();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.keepChange }));

            // Kept in the browser: the overview offers 수정 확정 and nothing was sent.
            expect(await screen.findByRole("button", { name: PINNED_COPY.commit })).toBeEnabled();
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();

            const preview = await startCommit();
            // The preview names the changed session, and nothing else as changed.
            expect(within(preview).getByText(PINNED_COPY.previewSessions([1]))).toBeInTheDocument();
            expect(within(preview).getByText(PINNED_COPY.previewHeader(false))).toBeInTheDocument();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.discardDraft).toHaveBeenCalledWith("draft-1", 2);
            expect(jest.mocked(adminServiceRecordEditApi.discardDraft).mock.invocationCallOrder[0])
                .toBeLessThan(jest.mocked(adminServiceRecordEditApi.startDraft).mock.invocationCallOrder[0]);
            expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledTimes(1);
            expect(jest.mocked(adminServiceRecordEditApi.startDraft).mock.calls[0]).toEqual([
                CLIENT_ID,
                { sessions: [{ sessionIndex: 1, answers: { sitzBath: "미실시" } }] },
            ]);
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.previewDraft).toHaveBeenCalledWith("draft-1", 1);

            fireEvent.click(within(preview).getByRole("button", { name: PINNED_COPY.commit }));

            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
            expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledWith("draft-1", 1, PREVIEW_ID, UUID);
            expect(global.fetch).toHaveBeenCalledWith(EDITOR_URL, expect.objectContaining({ cache: "no-store" }));
            expect(await screen.findByRole("button", dayCard(1))).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: PINNED_COPY.commit })).not.toBeInTheDocument();
        });
    });

    describe("basic information (header) edit", () => {
        it("9. a partial birthday is flagged and cannot be confirmed; a valid one is formatted and reaches the server as ISO", async () => {
            scriptCommit({ headerChanged: true, changedSessionIndexes: [] });
            renderWizard();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.headerEdit }));
            const birth = screen.getByLabelText(HEADER_LABELS.momBirth);
            expect(birth).toHaveValue(HEADER.momBirth);

            fireEvent.focus(birth);
            fireEvent.change(birth, { target: { value: "1999" } });
            fireEvent.blur(birth);

            expect(screen.getByText(getServiceRecordHeaderFieldError("momBirth", "1999")!)).toBeInTheDocument();
            expect(getServiceRecordHeaderFieldError("momBirth", "1999")).toBe("8자리로 입력해 주세요");
            const keep = screen.getByRole("button", { name: PINNED_COPY.keepChange });
            expect(keep).toBeDisabled();
            fireEvent.click(keep);
            expect(screen.queryByRole("button", { name: PINNED_COPY.commit })).not.toBeInTheDocument();
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();

            fireEvent.change(birth, { target: { value: "19990101" } });
            expect(birth).toHaveValue("1999-01-01");
            expect(screen.queryByText("8자리로 입력해 주세요")).not.toBeInTheDocument();
            expect(keep).toBeEnabled();
            fireEvent.click(keep);

            // Kept in the browser until 수정 확정.
            expect(await screen.findByRole("button", { name: PINNED_COPY.commit })).toBeEnabled();
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
            const preview = await startCommit();
            expect(within(preview).getByText(PINNED_COPY.previewHeader(true))).toBeInTheDocument();
            expect(within(preview).getByText(PINNED_COPY.previewSessions([]))).toBeInTheDocument();
            expect(jest.mocked(adminServiceRecordEditApi.startDraft).mock.calls[0]).toEqual([CLIENT_ID, { header: { momBirth: "1999-01-01" } }]);
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            fireEvent.click(within(preview).getByRole("button", { name: PINNED_COPY.commit }));

            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
            expect(adminServiceRecordEditApi.previewDraft).toHaveBeenCalledWith("draft-1", 1);
            expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledWith("draft-1", 1, PREVIEW_ID, UUID);
            // The saved record is read again and the editor returns to the overview.
            expect(global.fetch).toHaveBeenCalledWith(EDITOR_URL, expect.objectContaining({ cache: "no-store" }));
            expect(await screen.findByRole("button", dayCard(1))).toBeInTheDocument();
        });

        it("9. changing the delivery type sends only that field", async () => {
            scriptCommit({ headerChanged: true, changedSessionIndexes: [] });
            renderWizard();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.headerEdit }));

            chooseOption(DELIVERY_LABEL, "제왕절개");
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.keepChange }));
            expect(await screen.findByRole("button", { name: PINNED_COPY.commit })).toBeEnabled();
            const preview = await startCommit();
            expect(within(preview).getByText(PINNED_COPY.previewHeader(true))).toBeInTheDocument();
            expect(within(preview).getByText(PINNED_COPY.previewSessions([]))).toBeInTheDocument();
            fireEvent.click(within(preview).getByRole("button", { name: PINNED_COPY.commit }));

            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
            expect(jest.mocked(adminServiceRecordEditApi.startDraft).mock.calls[0]).toEqual([CLIENT_ID, { header: { deliveryType: "제왕절개" } }]);
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledWith("draft-1", 1, PREVIEW_ID, UUID);
        });

        it("9. a new name with a space is rejected and nothing is saved", () => {
            renderWizard();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.headerEdit }));

            fireEvent.change(screen.getByLabelText(HEADER_LABELS.momName), { target: { value: "이 예지" } });

            expect(screen.getByText(getServiceRecordHeaderFieldError("momName", "이 예지")!)).toBeInTheDocument();
            const save = screen.getByRole("button", { name: PINNED_COPY.keepChange });
            expect(save).toBeDisabled();
            fireEvent.click(save);
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        });
    });

    describe("session date edit", () => {
        it("10. a later business day for the 1회차, with the later sessions following, reaches the server as a date move", async () => {
            // 9/7 (Mon) -> 9/10 (Thu): the 2회차 and 3회차 follow by the same three business days.
            scriptCommit({ headerChanged: false, changedSessionIndexes: [] }, { 1: "2026-09-10", 2: "2026-09-11", 3: "2026-09-14" });
            renderWizard();
            fireEvent.click(screen.getByRole("button", dayCard(1)));

            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.dateEdit }));
            fireEvent.click(screen.getByRole("combobox", { name: "일" }));
            fireEvent.click(screen.getByRole("option", { name: "10일" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: PINNED_COPY.dateDialog(1) })).getByRole("button", { name: PINNED_COPY.dateApply }));
            fireEvent.click(within(screen.getByRole("dialog", { name: PINNED_COPY.followDialog })).getByRole("button", { name: PINNED_COPY.followApply }));
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.keepChange }));

            expect(await screen.findByRole("button", { name: PINNED_COPY.commit })).toBeEnabled();
            const preview = await startCommit();
            // The preview shows the moved 1회차 date and no content change.
            expect(within(preview).getByText(PINNED_COPY.previewDate("2026-09-10"))).toBeInTheDocument();
            expect(within(preview).getByText(PINNED_COPY.previewHeader(false))).toBeInTheDocument();
            expect(within(preview).getByText(PINNED_COPY.previewSessions([]))).toBeInTheDocument();
            // No content changed, so the draft starts empty and the move is applied on top.
            expect(jest.mocked(adminServiceRecordEditApi.startDraft).mock.calls[0]).toEqual([CLIENT_ID, undefined]);
            expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledTimes(1);
            expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith(
                "draft-1", 1, {}, { sessionIndex: 1, toDate: "2026-09-10", shiftFollowing: true },
            );
            expect(adminServiceRecordEditApi.previewDraft).toHaveBeenCalledWith("draft-1", 2);
            fireEvent.click(within(preview).getByRole("button", { name: PINNED_COPY.commit }));

            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
            expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledWith("draft-1", 2, PREVIEW_ID, UUID);
        });
    });

    describe("draft load failure", () => {
        it.each([
            [401, "로그인이 필요합니다. 초안 입력은 유지됩니다."],
            [403, "초안 접근 권한이 없습니다. 현재 입력은 유지됩니다."],
            [404, "초안을 찾을 수 없습니다. 현재 입력은 유지됩니다."],
            [409, "다른 관리자의 변경으로 저장되지 않았습니다. 입력은 유지되었습니다. 최신 초안을 불러오거나 내 입력을 유지하세요."],
            [500, "초안을 저장하지 못했습니다. 입력은 유지됩니다."],
        ])("11. a draft error status %i is explained to the administrator", (status, message) => {
            renderWizard({ initialDraftState: null, initialDraftErrorStatus: status });

            expect(screen.getByText(message)).toBeInTheDocument();
        });
    });
});
