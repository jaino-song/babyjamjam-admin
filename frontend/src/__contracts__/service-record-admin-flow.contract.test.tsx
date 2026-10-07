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

import {
    CLIENT_ID,
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
    /** Overview action that opens the basic-information editor (ServiceRecordAdminWizard.tsx:868). */
    headerEdit: "기본정보 수정",
    /** Confirms a changed basic-information form or session (ServiceRecordAdminWizard.tsx:874, :891). */
    saveChange: "수정 확인",
    /** The read-only signature image (ServiceRecordAdminWizard.tsx:394) and its empty state (:372). */
    signatureImage: "산모 서명",
    signatureMissing: "저장된 서명이 없어요",
    /** Banner action that opens a preview of an earlier unconfirmed edit (:808), and its confirm action. */
    reviewEarlierEdit: "이전 수정사항 검토",
    confirmEarlierEdit: "수정 확정",
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

/** A 회차 card is identified by its number only (not by its date or status words). */
const dayCard = (sessionIndex: number) => ({ name: new RegExp(`(^|\\D)${sessionIndex}(?!\\d)`) });

const decoration = /^[✓●]\s*/;

/**
 * Chooses one option of an item. `scope` is the item's visible title (or a
 * region element). When the title resolves to a labelled group the lookup stays
 * inside it; otherwise it falls back to the whole screen, where an option text
 * that is not unique fails loudly instead of picking by position.
 * Options are looked up as radio, then checkbox, then button.
 */
function chooseOption(scope: string | HTMLElement | undefined, optionText: string) {
    const root = scopeFor(scope);
    for (const role of ["radio", "checkbox", "button"] as const) {
        const found = root.queryAllByRole(role, {
            name: (accessibleName: string) => accessibleName.replace(decoration, "").trim() === optionText,
        });
        if (found.length > 1) throw new Error(`option "${optionText}" is ambiguous (${found.length} ${role}s); scope it`);
        if (found.length === 1) {
            fireEvent.click(found[0]);
            return;
        }
    }
    throw new Error(`option "${optionText}" not found as radio, checkbox or button`);
}

function scopeFor(scope: string | HTMLElement | undefined): ReturnType<typeof within> {
    if (scope instanceof HTMLElement) return within(scope);
    if (typeof scope !== "string") return screen;
    const named = [
        ...screen.queryAllByRole("radiogroup", { name: scope }),
        ...screen.queryAllByRole("group", { name: scope }),
    ];
    if (named.length === 1) return within(named[0]);
    // A group that holds the item's title as text; the innermost one wins.
    const holding = [...screen.queryAllByRole("radiogroup"), ...screen.queryAllByRole("group")]
        .filter((group) => within(group).queryAllByText(scope).length > 0);
    const innermost = holding.filter((group) => !holding.some((other) => other !== group && group.contains(other)));
    return innermost.length === 1 ? within(innermost[0]) : screen;
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

/** A saved edit goes start -> update -> preview -> confirm, then the overview is read again. */
function scriptSavedEdit(savedChanges: Record<string, unknown>, contentChanges: { headerChanged: boolean; changedSessionIndexes: number[] }) {
    jest.mocked(adminServiceRecordEditApi.startDraft).mockResolvedValue(makeDraftState());
    jest.mocked(adminServiceRecordEditApi.updateDraft).mockResolvedValue(makeDraftState(savedChanges, 2));
    jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue(
        makePreview(contentChanges) as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>,
    );
    jest.mocked(adminServiceRecordEditApi.confirmDraft).mockResolvedValue(
        confirmResult as Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>,
    );
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
        it.todo("8. edit a session answer, then 수정 확인: updateDraft -> previewDraft -> confirmDraft carry the change — blocked: packages/service-record-ui/src/ServiceRecordWizard.tsx:452-459 the review's per-section 수정 buttons (three, plus the date editor at frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:885) share one accessible name and have no accessible container, so the one that opens the input pages cannot be told apart without picking by position");

        it("8. confirming an earlier unconfirmed edit previews it and confirms with the preview's ids, without a new update", async () => {
            const earlier = makeDraftState({ header: { momName: "기존 수정 산모" }, sessions: [{ sessionIndex: 2, etcService: "이전 수정 내용" }] }, 2);
            jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue(earlier);
            jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue(
                makePreview({ headerChanged: true, changedSessionIndexes: [2] }) as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>,
            );
            jest.mocked(adminServiceRecordEditApi.confirmDraft).mockResolvedValue(
                confirmResult as Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>,
            );
            renderWizard({ initialDraftState: earlier });

            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.reviewEarlierEdit }));
            const confirm = await screen.findByRole("button", { name: PINNED_COPY.confirmEarlierEdit });
            await waitFor(() => expect(confirm).toBeEnabled());
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
            fireEvent.click(confirm);

            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
            expect(adminServiceRecordEditApi.previewDraft).toHaveBeenCalledWith("draft-1", 2);
            expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledWith("draft-1", 2, PREVIEW_ID, expect.any(String));
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        });
    });

    describe("basic information (header) edit", () => {
        it("9. a partial birthday is flagged and cannot be confirmed; a valid one is formatted and saved as ISO", async () => {
            scriptSavedEdit({ header: { momBirth: "1999-01-01" } }, { headerChanged: true, changedSessionIndexes: [] });
            renderWizard();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.headerEdit }));
            const birth = screen.getByLabelText(HEADER_LABELS.momBirth);
            expect(birth).toHaveValue(HEADER.momBirth);

            fireEvent.focus(birth);
            fireEvent.change(birth, { target: { value: "1999" } });
            fireEvent.blur(birth);

            expect(screen.getByText(getServiceRecordHeaderFieldError("momBirth", "1999")!)).toBeInTheDocument();
            expect(getServiceRecordHeaderFieldError("momBirth", "1999")).toBe("8자리로 입력해 주세요");
            const save = screen.getByRole("button", { name: PINNED_COPY.saveChange });
            expect(save).toBeDisabled();
            fireEvent.click(save);
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();

            fireEvent.change(birth, { target: { value: "19990101" } });
            expect(birth).toHaveValue("1999-01-01");
            expect(screen.queryByText("8자리로 입력해 주세요")).not.toBeInTheDocument();
            expect(save).toBeEnabled();
            fireEvent.click(save);

            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
            expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith(
                "draft-1", 1, { header: { momBirth: "1999-01-01" } }, undefined,
            );
            expect(adminServiceRecordEditApi.previewDraft).toHaveBeenCalledWith("draft-1", 2);
            expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledWith("draft-1", 2, PREVIEW_ID, expect.any(String));
            // The saved record is read again and the editor returns to the overview.
            expect(global.fetch).toHaveBeenCalledWith(EDITOR_URL, expect.objectContaining({ cache: "no-store" }));
            expect(await screen.findByRole("button", dayCard(1))).toBeInTheDocument();
        });

        it("9. changing the delivery type saves only that field", async () => {
            scriptSavedEdit({ header: { deliveryType: "제왕절개" } }, { headerChanged: true, changedSessionIndexes: [] });
            renderWizard();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.headerEdit }));

            chooseOption(DELIVERY_LABEL, "제왕절개");
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.saveChange }));

            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
            expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith(
                "draft-1", 1, { header: { deliveryType: "제왕절개" } }, undefined,
            );
        });

        it("9. a new name with a space is rejected and nothing is saved", () => {
            renderWizard();
            fireEvent.click(screen.getByRole("button", { name: PINNED_COPY.headerEdit }));

            fireEvent.change(screen.getByLabelText(HEADER_LABELS.momName), { target: { value: "이 예지" } });

            expect(screen.getByText(getServiceRecordHeaderFieldError("momName", "이 예지")!)).toBeInTheDocument();
            const save = screen.getByRole("button", { name: PINNED_COPY.saveChange });
            expect(save).toBeDisabled();
            fireEvent.click(save);
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        });
    });

    describe("session date edit", () => {
        it.todo("10. open the date editor, pick a later business day, 수정 확인: updateDraft carries the date move — blocked: frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx:885 the date editor's 수정 button shares its accessible name with the three review-section 수정 buttons (packages/service-record-ui/src/ServiceRecordWizard.tsx:452-459) and sits in a div without an accessible container");
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
