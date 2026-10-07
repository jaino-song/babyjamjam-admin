import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { isBusinessDayKr, KR_BUILTIN_HOLIDAYS } from "../src/lib/date/business-days";

const LOCAL_ORIGIN = "http://127.0.0.1:3107";
const CLIENT_ID = "42";
const CASE_ID = "case-phase6-42";
const DRAFT_ID = "draft-phase6-42";

const plannedDates = [
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
    "2026-07-13",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-20",
] as const;

const answers = {
    perineum: ["이상없음"],
    breast: ["이상없음"],
    excretion: ["이상없음"],
    sitzBath: "실시",
    meals_meal: "3",
    meals_snack: "1",
    temperature_temp: "36.5",
    sleep: "잘 잠",
    breastFeeding_count: "3",
    formulaFeeding_count: "2",
    formulaFeeding_ml: "90",
    stool: "정상변",
    bath: "실시",
    paymentConfirmed: true,
};

type SessionChange = {
    sessionIndex: number;
    serviceDate?: string;
    answers?: Record<string, unknown>;
    etcService?: string;
    notes?: string;
    paymentConfirmed?: boolean;
};

type Draft = {
    id: string;
    branchId: string;
    serviceRecordCaseId: string;
    sourceCaseVersion: number;
    sourceFingerprint: string;
    sourceSnapshot: Record<string, unknown>;
    changes: { header?: Record<string, string>; sessions?: SessionChange[] };
    draftVersion: number;
    status: "ACTIVE" | "DISCARDED";
    createdByUserId: string;
    updatedByUserId: string;
    discardedByUserId: string | null;
    createdAt: string;
    updatedAt: string;
    discardedAt: string | null;
};

type DraftState = {
    draft: Draft | null;
    sourceChanged: boolean;
    sourceCaseVersion: number;
    sourceFingerprint: string;
};

/**
 * How the next confirm request fails (it fails once, then confirms normally):
 * - "closed-by-other-tab": 409 without a blockingOperation; the server draft is
 *   gone but the case source is unchanged.
 * - "source-changed": 409 without a blockingOperation; the case moved on (new
 *   version and fingerprint), so the editor must refresh.
 * - "contract_period" / "receipt_refresh": 409 carrying a blockingOperation.
 */
type ConfirmConflict = "closed-by-other-tab" | "source-changed" | "contract_period" | "receipt_refresh";

type MockOptions = {
    initialDraft?: DraftState;
    confirmConflict?: ConfirmConflict;
    generationFailure?: boolean;
};

type MockEvidence = {
    state: DraftState;
    requests: Array<{ method: string; pathname: string; body: unknown }>;
    unsafeRequests: string[];
    unhandledApiRequests: string[];
    /** Draft writes in the order they were sent: start, update, preview, confirm, discard. */
    writeSteps: () => string[];
    /** Another admin confirmed the case: the server moves to `caseVersion` and announces it on the event stream. */
    announceCaseChange: (caseVersion: number) => Promise<void>;
    assertSafe: () => void;
};

const CONFIRMED_FINGERPRINT = "phase6-confirmed-fingerprint";
const EVENTS_PATHNAME = "/api/admin/service-records/events";

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function shiftBusinessDays(isoDate: string, offset: number): string {
    const current = new Date(`${isoDate}T00:00:00.000Z`);
    const direction = offset < 0 ? -1 : 1;
    let remaining = Math.abs(offset);
    while (remaining > 0) {
        current.setUTCDate(current.getUTCDate() + direction);
        if (isBusinessDayKr(current.toISOString().slice(0, 10))) remaining -= 1;
    }
    return current.toISOString().slice(0, 10);
}

function businessDayDistance(from: string, to: string): number {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    const direction = start <= end ? 1 : -1;
    let distance = 0;
    while (start.toISOString().slice(0, 10) !== to) {
        start.setUTCDate(start.getUTCDate() + direction);
        if (isBusinessDayKr(start.toISOString().slice(0, 10))) distance += direction;
    }
    return distance;
}

function makeSession(sessionIndex: number, serviceDate: string): Record<string, unknown> {
    return {
        sessionIndex,
        serviceDate,
        locked: sessionIndex === 1,
        submittedAt: sessionIndex === 1 ? "2026-07-01T12:00:00.000Z" : null,
        updatedAt: "2026-07-01T00:00:00.000Z",
        answers: clone(answers),
        etcService: "",
        notes: "",
        paymentConfirmed: true,
        hasMomApproval: sessionIndex === 1,
        employeeId: 501,
        employeeName: "김제공",
        formVersion: 1,
        ...(sessionIndex === 1
            ? {
                clientSignature: "data:image/png;base64,phase6-signature",
                clientSignedAt: "2026-07-01T12:00:00.000Z",
            }
            : {}),
    };
}

function makeOverview(): Record<string, unknown> {
    const header = {
        momName: "김산모",
        momBirth: "900101",
        babyName: "김아기",
        babyBirth: "260614",
        deliveryType: "자연분만",
        babyWeight: "3.2",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const sessions = plannedDates.map((serviceDate, index) => makeSession(index + 1, serviceDate));
    return {
        record: {
            id: CASE_ID,
            status: "IN_PROGRESS",
            startDate: plannedDates[0],
            endDate: "2026-07-31",
            totalSessions: plannedDates.length,
            completedAt: null,
            finalizationDueAt: null,
            finalizedAt: null,
            documentsCompletedAt: null,
            lastError: null,
            header,
            sessions,
            signatureDocs: [],
        },
        assignments: [],
        scheduleProjection: {
            entries: plannedDates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: "assignment-phase6",
                scheduleId: 601,
                employeeId: 501,
                provenanceVersion: "projection-phase6-1",
            })),
            blockingReasons: [],
        },
    };
}

function makeDraftState(
    changes: Draft["changes"] = {},
    draftVersion = 1,
): DraftState {
    const now = "2026-09-09T00:00:00.000Z";
    return {
        draft: {
            id: DRAFT_ID,
            branchId: "branch-phase6",
            serviceRecordCaseId: CASE_ID,
            sourceCaseVersion: 7,
            sourceFingerprint: "phase6-source-fingerprint",
            sourceSnapshot: {},
            changes: clone(changes),
            draftVersion,
            status: "ACTIVE",
            createdByUserId: "admin-phase6",
            updatedByUserId: "admin-phase6",
            discardedByUserId: null,
            createdAt: now,
            updatedAt: now,
            discardedAt: null,
        },
        sourceChanged: false,
        sourceCaseVersion: 7,
        sourceFingerprint: "phase6-source-fingerprint",
    };
}

/** The server holds no draft: what a case with no earlier edit session reports. */
function makeEmptyDraftState(): DraftState {
    return {
        draft: null,
        sourceChanged: false,
        sourceCaseVersion: 7,
        sourceFingerprint: "phase6-source-fingerprint",
    };
}

function mergeChanges(
    current: Draft["changes"],
    incoming: Draft["changes"],
    dateMove?: { sessionIndex: number; toDate: string; shiftFollowing?: boolean },
): Draft["changes"] {
    const byIndex = new Map<number, SessionChange>();
    for (const session of current.sessions ?? []) byIndex.set(session.sessionIndex, clone(session));
    for (const session of incoming.sessions ?? []) {
        const previous = byIndex.get(session.sessionIndex);
        byIndex.set(session.sessionIndex, {
            ...(previous ?? { sessionIndex: session.sessionIndex }),
            ...clone(session),
            ...(session.answers
                ? { answers: { ...(previous?.answers ?? {}), ...clone(session.answers) } }
                : {}),
        });
    }
    if (dateMove) {
        const sourceDate = plannedDates[dateMove.sessionIndex - 1];
        if (sourceDate) {
            const offset = businessDayDistance(sourceDate, dateMove.toDate);
            for (let index = dateMove.sessionIndex; index <= plannedDates.length; index += 1) {
                if (index !== dateMove.sessionIndex && !dateMove.shiftFollowing) break;
                const previous = byIndex.get(index);
                byIndex.set(index, {
                    ...(previous ?? { sessionIndex: index }),
                    serviceDate: shiftBusinessDays(plannedDates[index - 1], offset),
                });
            }
        }
    }
    const sessions = [...byIndex.values()].sort((left, right) => left.sessionIndex - right.sessionIndex);
    return {
        ...(current.header || incoming.header
            ? { header: { ...(current.header ?? {}), ...(incoming.header ?? {}) } }
            : {}),
        ...(sessions.length > 0 ? { sessions } : {}),
    };
}

function previewFor(state: DraftState): Record<string, unknown> {
    const dateOverrides = new Map(
        (state.draft?.changes.sessions ?? [])
            .filter((session) => typeof session.serviceDate === "string")
            .map((session) => [session.sessionIndex, session.serviceDate as string]),
    );
    const before = plannedDates.map((serviceDate, index) => ({
        sessionIndex: index + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: "assignment-phase6",
        scheduleId: 601,
        employeeId: 501,
        provenanceVersion: "projection-phase6-1",
    }));
    const after = before.map((session) => ({
        ...session,
        serviceDate: dateOverrides.get(session.sessionIndex) ?? session.serviceDate,
    }));
    const changedSessionIndexes = (state.draft?.changes.sessions ?? [])
        .filter((session) => Object.keys(session).some((key) => key !== "sessionIndex"))
        .map((session) => session.sessionIndex);
    return {
        previewId: "preview-phase6-1",
        draftId: DRAFT_ID,
        draftVersion: state.draft?.draftVersion ?? 1,
        sourceCaseVersion: 7,
        sourceFingerprint: "phase6-source-fingerprint",
        requiredSessionCount: plannedDates.length,
        calendarVersion: "kr-2026",
        before: { startDate: plannedDates[0], endDate: plannedDates[plannedDates.length - 1], sessions: before },
        after: { startDate: plannedDates[0], endDate: "2026-08-10", sessions: after },
        provenance: [{
            assignmentId: "assignment-phase6",
            scheduleId: 601,
            employeeId: 501,
            startDate: "2026-07-01",
            endDate: "2026-08-10",
            provenanceVersion: "projection-phase6-1",
        }],
        contentChanges: {
            headerChanged: Boolean(state.draft?.changes.header),
            changedSessionIndexes: [...new Set(changedSessionIndexes)],
        },
        impactedAssignments: ["assignment-phase6"],
        blockingReasons: [],
        signatureMetadata: {
            treatment: "preserve_existing",
            evidence: "observed",
            sessions: [{
                sessionIndex: 1,
                hasSignature: true,
                signedAt: "2026-07-01T12:00:00.000Z",
                submittedAt: "2026-07-01T12:00:00.000Z",
            }],
        },
        documentScope: {
            evidence: "observed",
            serviceRecordSnapshot: { documentIds: ["record-doc-phase6"], snapshotVersion: 1, chunks: [] },
            currentRevision: { id: null, revisionNumber: null, formVersion: null },
            form: { version: 1 },
            contract: { currentDocumentId: "contract-doc-phase6", stage: "in_progress" },
        },
    };
}

function confirmResponse(state: DraftState, generationFailure: boolean): Record<string, unknown> {
    return {
        status: "confirmed",
        caseId: CASE_ID,
        clientId: Number(CLIENT_ID),
        draftId: DRAFT_ID,
        draftVersion: state.draft?.draftVersion ?? 1,
        caseVersion: 8,
        revisionId: "revision-phase6-1",
        revisionNumber: 1,
        documentStatus: generationFailure ? "capability_unverified" : "waiting_for_completion",
        confirmedAt: "2026-09-09T01:02:03.000Z",
    };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });
}

async function installMocks(page: Page, options: MockOptions = {}): Promise<MockEvidence> {
    const state = clone(options.initialDraft ?? makeEmptyDraftState());
    const requests: MockEvidence["requests"] = [];
    const unsafeRequests: string[] = [];
    const unhandledApiRequests: string[] = [];
    let confirmConflict = options.confirmConflict ?? null;
    const generationFailure = options.generationFailure === true;
    let previewSequence = 0;
    // The app keeps one EventSource open; its request stays pending until a test announces a case change.
    const heldEventStreams: Route[] = [];
    let confirmedChanges: Draft["changes"] = {};

    page.on("request", (request) => {
        const url = new URL(request.url());
        if (
            url.origin !== LOCAL_ORIGIN
            || url.pathname === "/api/auth/login"
            || /eformsign|vendor|external/i.test(url.hostname + url.pathname)
        ) {
            unsafeRequests.push(request.url());
        }
    });

    // This guard is registered first; the API handler below is registered
    // later so Playwright gives known fixtures precedence. Any unknown API or
    // non-loopback request is aborted and recorded as a test failure.
    await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== LOCAL_ORIGIN || url.pathname.startsWith("/api/")) {
            return route.abort();
        }
        return route.continue();
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const method = request.method();
        const url = new URL(request.url());
        const pathname = url.pathname;
        let body: unknown = undefined;
        try {
            body = request.postDataJSON();
        } catch {
            body = undefined;
        }
        requests.push({ method, pathname, body });

        if (pathname === "/api/auth/me" && method === "GET") {
            return json(route, 200, {
                id: "e2e-user",
                name: "Phase6 관리자",
                email: "phase6@example.test",
                role: "admin",
                branchId: "branch-phase6",
                branchName: "Phase6 격리 지점",
            });
        }
        if (pathname === "/api/auth/session" && method === "GET") {
            return json(route, 200, { user: { id: "e2e-user", role: "admin" } });
        }
        if (pathname === "/api/auth/refresh" && method === "POST") {
            return json(route, 200, { ok: true });
        }
        if (pathname === `/api/admin/service-records/client/${CLIENT_ID}/editor` && method === "GET") {
            const overview = makeOverview();
            const record = overview.record as { sessions: Record<string, unknown>[] };
            record.sessions = record.sessions.map((session) => {
                const change = confirmedChanges.sessions?.find((entry) => entry.sessionIndex === session.sessionIndex);
                return change ? { ...session, ...change, answers: { ...(session.answers as object), ...change.answers } } : session;
            });
            return json(route, 200, overview);
        }
        if (pathname === EVENTS_PATHNAME && method === "GET") {
            heldEventStreams.push(route);
            return;
        }
        if (pathname === `/api/admin/service-records/client/${CLIENT_ID}/draft` && method === "GET") {
            return json(route, 200, state);
        }
        if (pathname === `/api/admin/service-records/client/${CLIENT_ID}/draft` && method === "POST") {
            const requestedChanges = (body as { changes?: Draft["changes"] } | undefined)?.changes ?? {};
            const next = makeDraftState(requestedChanges, 1);
            state.draft = next.draft;
            state.sourceChanged = next.sourceChanged;
            state.sourceCaseVersion = next.sourceCaseVersion;
            state.sourceFingerprint = next.sourceFingerprint;
            return json(route, 201, state);
        }
        if (pathname === `/api/admin/service-records/drafts/${DRAFT_ID}` && method === "PATCH") {
            if (!state.draft) return json(route, 404, { code: "DRAFT_NOT_FOUND" });
            const patch = (body ?? {}) as {
                expectedDraftVersion?: number;
                changes?: Draft["changes"];
                dateMove?: { sessionIndex: number; toDate: string; shiftFollowing?: boolean };
            };
            if (patch.expectedDraftVersion !== state.draft.draftVersion) {
                return json(route, 409, {
                    code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT",
                    latestDraft: state.draft,
                    sourceChanged: state.sourceChanged,
                });
            }
            state.draft.changes = mergeChanges(state.draft.changes, patch.changes ?? {}, patch.dateMove);
            state.draft.draftVersion += 1;
            state.draft.updatedAt = "2026-09-09T01:03:00.000Z";
            return json(route, 200, state);
        }
        if (pathname === `/api/admin/service-records/drafts/${DRAFT_ID}/preview` && method === "POST") {
            if (!state.draft) return json(route, 404, { code: "DRAFT_NOT_FOUND" });
            previewSequence += 1;
            return json(route, 200, { ...previewFor(state), previewId: `preview-phase6-${previewSequence}` });
        }
        if (pathname === `/api/admin/service-records/drafts/${DRAFT_ID}/discard` && method === "POST") {
            state.draft = null;
            return json(route, 200, state);
        }
        if (pathname === `/api/admin/service-records/drafts/${DRAFT_ID}/confirm` && method === "POST") {
            if (confirmConflict) {
                const conflict = confirmConflict;
                confirmConflict = null;
                if (conflict === "contract_period" || conflict === "receipt_refresh") {
                    return json(route, 409, {
                        code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT",
                        blockingOperation: { operation: conflict, status: "RUNNING", lastErrorCode: null },
                    });
                }
                // Either way the server no longer has this draft open.
                state.draft = null;
                if (conflict === "source-changed") {
                    state.sourceCaseVersion = 8;
                    state.sourceFingerprint = CONFIRMED_FINGERPRINT;
                }
                return json(route, 409, { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" });
            }
            if (!state.draft) return json(route, 404, { code: "DRAFT_NOT_FOUND" });
            const result = confirmResponse(state, generationFailure);
            confirmedChanges = clone(state.draft.changes);
            state.draft = null;
            state.sourceCaseVersion = 8;
            state.sourceFingerprint = CONFIRMED_FINGERPRINT;
            return json(route, 200, result);
        }
        unhandledApiRequests.push(`${method} ${pathname}`);
        return route.abort();
    });

    // Branch holiday calendar for the apps' business-day maths (built-in list, no branch changes).
    await page.route("**/api/branches/*/holidays**", async (route) => {
        const year = Number(new URL(route.request().url()).searchParams.get("year"));
        const holidays = KR_BUILTIN_HOLIDAYS
            .filter((date) => date.startsWith(`${year}-`))
            .map((date) => ({ date, name: "공휴일", source: "builtin", excluded: false, overrideId: null }));
        return json(route, 200, { year, revision: 1, supported: holidays.length > 0, synced: true, lastSyncedAt: null, holidays, inactiveOverrides: [] });
    });

    const evidence: MockEvidence = {
        state,
        requests,
        unsafeRequests,
        unhandledApiRequests,
        writeSteps: () => requests
            .filter((request) => request.method !== "GET")
            .map((request) => {
                if (request.pathname.endsWith("/preview")) return "preview";
                if (request.pathname.endsWith("/confirm")) return "confirm";
                if (request.pathname.endsWith("/discard")) return "discard";
                if (request.method === "POST" && request.pathname.endsWith("/draft")) return "start";
                if (request.method === "PATCH") return "update";
                return `${request.method} ${request.pathname}`;
            }),
        announceCaseChange: async (caseVersion) => {
            state.sourceCaseVersion = caseVersion;
            state.sourceFingerprint = CONFIRMED_FINGERPRINT;
            await expect.poll(() => heldEventStreams.length, { message: "the editor opens the case event stream" }).toBeGreaterThan(0);
            // A development double-mount leaves one closed stream in the list; fulfilling it throws and is skipped.
            for (const stream of heldEventStreams.splice(0)) {
                await stream.fulfill({
                    status: 200,
                    contentType: "text/event-stream",
                    headers: { "cache-control": "no-cache" },
                    body: `event: case-changed\ndata: ${JSON.stringify({ caseId: CASE_ID, caseVersion })}\n\n`,
                }).catch(() => undefined);
            }
        },
        assertSafe: () => {
            expect(unhandledApiRequests, "unexpected API route").toEqual([]);
            expect(unsafeRequests, "live auth/vendor/external request").toEqual([]);
        },
    };
    return evidence;
}

async function enableLocalAdminAuth(page: Page): Promise<void> {
    const tokenPayload = Buffer.from(JSON.stringify({
        exp: 4_102_444_800,
        sub: "e2e-user",
        sid: "phase6-session",
        type: "access",
        branchId: "branch-phase6",
        role: "admin",
    })).toString("base64url");
    const authToken = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${tokenPayload}.phase6`;
    await page.context().addCookies([
        { name: "auth_token", value: authToken, url: LOCAL_ORIGIN, sameSite: "Lax" },
        { name: "e2e_auth", value: "1", url: LOCAL_ORIGIN, sameSite: "Lax" },
    ]);
    await page.addInitScript(() => {
        window.sessionStorage.clear();
    });
}

async function openEditor(page: Page): Promise<void> {
    await page.goto(`/service-record-admin/${CLIENT_ID}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-component="desktop_service-record-admin_wizard"]')).toBeVisible();
    await expect(page.locator('[data-slot="day"]')).toHaveCount(plannedDates.length);
}

async function openDay(page: Page, sessionIndex: number): Promise<void> {
    await page.locator('[data-slot="day"]').nth(sessionIndex - 1).click();
    await expect(page.locator('[data-component="desktop_service-record-admin_wizard_body_day-title"]')).toBeVisible();
}


async function goToServicePage(page: Page): Promise<void> {
    await page.locator('[data-slot="review"] [data-slot="sec-edit"]').nth(2).click();
}

async function applyDateMove(page: Page, day: string): Promise<void> {
    await page.locator('[data-component$="_body_date-edit"]').click();
    const dialog = page.getByRole("dialog", { name: "1회차 서비스 제공일 수정" });
    await dialog.getByRole("combobox", { name: "일" }).click();
    await page.getByRole("option", { name: `${Number(day)}일` }).click();
    await dialog.getByRole("button", { name: "수정", exact: true }).click();
    const followModal = page.locator('[data-component$="_date-follow-modal"]');
    await expect(followModal).toBeVisible();
    await followModal.getByRole("button", { name: "변경하기", exact: true }).click();
    await expect(followModal).toBeHidden();
}

const REFRESH_MODAL_TITLE = "새로운 수정 사항이 있어서 새로고침이 필요해요";
const PREVIEW_TITLE = "초안 변경 미리보기";
const CLOSED_DRAFT_MESSAGE = "다른 화면에서 수정 확정을 시작해서 이 확인이 취소되었어요. 수정 확정을 다시 눌러 주세요.";

/** From an open day screen: change the service note and keep it with 수정 확인 (browser only). */
async function editNoteAndAccept(page: Page, note: string): Promise<void> {
    await goToServicePage(page);
    await page.getByRole("textbox", { name: "특이사항 (필요 시 기재)", exact: true }).fill(note);
    await page.getByRole("button", { name: "다음" }).click();
    await page.getByRole("button", { name: "수정 확인", exact: true }).click();
    await expect(page.locator('[data-slot="day"]')).toHaveCount(plannedDates.length);
    await expect(page.locator('[data-slot="day"]').first()).toContainText("초안 변경");
}

async function stageNote(page: Page, note: string): Promise<void> {
    await openDay(page, 1);
    await editNoteAndAccept(page, note);
}

function commitButton(page: Page) {
    return page.locator('[data-component$="_body_overview-commit_confirm"]');
}

/** 수정 확정 on the overview: starts the server draft and opens its preview. */
async function startCommit(page: Page) {
    await commitButton(page).click();
    const preview = page.getByRole("dialog", { name: PREVIEW_TITLE });
    await expect(preview).toBeVisible();
    return preview;
}

test.beforeEach(async ({ page }) => {
    await enableLocalAdminAuth(page);
});

test("session review retains all fields and dates and writes only after confirmation", async ({ page }, testInfo: TestInfo) => {
    const evidence = await installMocks(page);
    await openEditor(page);
    await expect(page.locator('[data-slot="admin-toolbar"]')).toHaveCount(0);
    await openDay(page, 1);
    await expect(page.locator('[data-component$="_body_review_section"]')).toHaveCount(3);
    await expect(page.locator('[data-component$="_body_review_section_row"], [data-component$="_body_review_section_note"]')).toHaveCount(14);
    await expect(page.getByRole("img", { name: "산모 서명" })).toHaveAttribute("src", /phase6-signature/);
    await applyDateMove(page, "20");
    await expect(page.locator('[data-component$="_body_date-chip_date-display"]')).toContainText("2026.07.20");
    await expect(page.locator('[data-component$="_body_date-chip_date-display"]')).toContainText("원본 2026.07.01");
    await page.locator('[data-slot="review"] [data-slot="sec-edit"]').nth(1).click();
    await page.getByLabel("체온").fill("36.7");
    await page.getByRole("button", { name: "다음" }).click();
    await goToServicePage(page);
    await page.getByRole("textbox", { name: "특이사항 (필요 시 기재)", exact: true }).fill("회차 수정 테스트 메모");
    await page.getByRole("button", { name: "다음" }).click();
    expect(evidence.writeSteps()).toEqual([]);

    // 수정 확인 keeps the edit in the browser: no request of any kind leaves the page.
    const requestsBeforeAccept = evidence.requests.length;
    await page.getByRole("button", { name: "수정 확인", exact: true }).click();
    await expect(page.locator('[data-slot="day"]')).toHaveCount(plannedDates.length);
    await expect(page.locator('[data-slot="day"]').first()).toContainText("초안 변경");
    await expect(page.locator('[data-slot="day"]').first()).toContainText("2026.07.20");
    expect(evidence.requests).toHaveLength(requestsBeforeAccept);
    expect(evidence.writeSteps()).toEqual([]);

    // 수정 확정 writes the staged edits and previews them; nothing is confirmed yet.
    const preview = await startCommit(page);
    await expect(preview).toContainText("변경 전");
    expect(evidence.writeSteps()).toEqual(["start", "update", "preview"]);

    await preview.getByRole("button", { name: "수정 확정", exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(page.locator('[data-slot="day"]')).toHaveCount(plannedDates.length);
    await expect(commitButton(page)).toHaveCount(0);
    expect(evidence.writeSteps()).toEqual(["start", "update", "preview", "confirm"]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-slot="day"]').first()).toContainText("2026.07.20");
    await openDay(page, 1);
    await expect(page.locator('[data-slot="review"]')).toContainText("회차 수정 테스트 메모");
    await expect(page.locator('[data-slot="review"]')).toContainText("36.7");
    await page.screenshot({ path: testInfo.outputPath("admin-desktop-confirmed.png"), fullPage: true });
    evidence.assertSafe();
});

test("a durable previous draft is ignored at load and discarded before the new edits are saved", async ({ page }) => {
    const evidence = await installMocks(page, { initialDraft: makeDraftState({ sessions: [{ sessionIndex: 1, notes: "재개된 초안 메모" }] }) });
    await openEditor(page);
    await expect(page.getByRole("button", { name: "이전 수정사항 검토" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-slot="day"]').filter({ hasText: "초안 변경" })).toHaveCount(0);
    await expect(commitButton(page)).toHaveCount(0);
    await openDay(page, 1);
    await expect(page.locator('[data-slot="review"]')).not.toContainText("재개된 초안 메모");

    await editNoteAndAccept(page, "새로 입력한 메모");
    expect(evidence.writeSteps()).toEqual([]);

    const preview = await startCommit(page);
    expect(evidence.writeSteps()).toEqual(["discard", "start", "preview"]);
    const discard = evidence.requests.find((request) => request.pathname.endsWith("/discard"));
    expect(discard?.body).toMatchObject({ expectedDraftVersion: 1 });
    const start = evidence.requests.find((request) => request.method === "POST" && request.pathname.endsWith("/draft"));
    expect((start?.body as { changes: { sessions: unknown[] } }).changes.sessions).toMatchObject([{ sessionIndex: 1, notes: "새로 입력한 메모" }]);
    expect(JSON.stringify(start?.body)).not.toContain("재개된 초안 메모");

    await preview.getByRole("button", { name: "수정 확정", exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(page.locator('[data-slot="day"]')).toHaveCount(plannedDates.length);
    expect(evidence.writeSteps()).toEqual(["discard", "start", "preview", "confirm"]);
    evidence.assertSafe();
});

test("closing the preview discards the server draft and keeps the local edits", async ({ page }) => {
    const evidence = await installMocks(page);
    await openEditor(page);
    await stageNote(page, "닫아도 남는 메모");
    const preview = await startCommit(page);
    await preview.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(preview).toBeHidden();
    await expect.poll(() => evidence.writeSteps()).toEqual(["start", "preview", "discard"]);
    expect(evidence.state.draft).toBeNull();
    await expect(page.locator('[data-slot="day"]').first()).toContainText("초안 변경");
    await expect(commitButton(page)).toBeEnabled();
    await openDay(page, 1);
    await expect(page.locator('[data-slot="review"]')).toContainText("닫아도 남는 메모");
    evidence.assertSafe();
});

test("a confirm conflict on an unchanged source keeps the edits and asks to confirm again", async ({ page }) => {
    const evidence = await installMocks(page, { confirmConflict: "closed-by-other-tab" });
    await openEditor(page);
    await stageNote(page, "내 입력 보존");
    const preview = await startCommit(page);
    await preview.getByRole("button", { name: "수정 확정", exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(page.locator('[data-slot="commit-error"]')).toContainText(CLOSED_DRAFT_MESSAGE);
    await expect(page.getByRole("dialog", { name: REFRESH_MODAL_TITLE })).toHaveCount(0);
    await expect(page.locator('[data-slot="day"]').first()).toContainText("초안 변경");
    await expect(commitButton(page)).toBeEnabled();
    await openDay(page, 1);
    await expect(page.locator('[data-slot="review"]')).toContainText("내 입력 보존");
    await page.getByRole("button", { name: "확인", exact: true }).click();

    // Pressing 수정 확정 again saves the same edits from scratch.
    const retryPreview = await startCommit(page);
    await retryPreview.getByRole("button", { name: "수정 확정", exact: true }).click();
    await expect(retryPreview).toBeHidden();
    await expect(commitButton(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="commit-error"]')).toHaveCount(0);
    expect(evidence.writeSteps()).toEqual(["start", "preview", "confirm", "start", "preview", "confirm"]);
    evidence.assertSafe();
});

test("a confirm conflict on a changed source requires a refresh that drops the local edits", async ({ page }) => {
    const evidence = await installMocks(page, { confirmConflict: "source-changed" });
    await openEditor(page);
    await stageNote(page, "곧 사라질 입력");
    const preview = await startCommit(page);
    await preview.getByRole("button", { name: "수정 확정", exact: true }).click();
    const refreshModal = page.getByRole("dialog", { name: REFRESH_MODAL_TITLE });
    await expect(refreshModal).toBeVisible();
    await expect(preview).toBeHidden();
    // The modal is blocking: Escape does not close it.
    await page.keyboard.press("Escape");
    await expect(refreshModal).toBeVisible();
    expect(evidence.writeSteps().filter((step) => step === "confirm")).toHaveLength(1);

    await refreshModal.getByRole("button", { name: "확인", exact: true }).click();
    await expect(refreshModal).toBeHidden();
    await expect(page.locator('[data-slot="day"]')).toHaveCount(plannedDates.length);
    await expect(page.locator('[data-slot="day"]').filter({ hasText: "초안 변경" })).toHaveCount(0);
    await expect(commitButton(page)).toHaveCount(0);
    await openDay(page, 1);
    await expect(page.locator('[data-slot="review"]')).not.toContainText("곧 사라질 입력");
    expect(evidence.writeSteps().filter((step) => step === "confirm")).toHaveLength(1);
    evidence.assertSafe();
});

test("unverified document generation does not become a false document completion claim", async ({ page }) => {
    const evidence = await installMocks(page, { generationFailure: true });
    await openEditor(page);
    await stageNote(page, "문서 처리 확인");
    const preview = await startCommit(page);
    await preview.getByRole("button", { name: "수정 확정", exact: true }).click();
    await expect(preview).toBeHidden();
    expect(evidence.writeSteps().filter((step) => step === "confirm")).toHaveLength(1);
    await expect(page.getByText("전자문서 처리 완료")).toHaveCount(0);
    evidence.assertSafe();
});

for (const [operation, message] of [
    ["contract_period", "이전 수정의 계약서 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요."],
    ["receipt_refresh", "이전 수정의 영수증 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요."],
] as const) {
    test(`a confirm blocked by ${operation} explains itself without asking for a refresh`, async ({ page }) => {
        const evidence = await installMocks(page, { confirmConflict: operation });
        await openEditor(page);
        await stageNote(page, "반영 대기 중 메모");
        const preview = await startCommit(page);
        await preview.getByRole("button", { name: "수정 확정", exact: true }).click();
        await expect(preview.getByText(message)).toBeVisible();
        await expect(page.getByRole("dialog", { name: REFRESH_MODAL_TITLE })).toHaveCount(0);

        // Closing the preview leaves the line on the overview and the edits in place.
        await preview.getByRole("button", { name: "닫기", exact: true }).click();
        await expect(preview).toBeHidden();
        await expect(page.locator('[data-slot="commit-error"]')).toContainText(message);
        await expect(page.locator('[data-slot="day"]').first()).toContainText("초안 변경");
        await expect(commitButton(page)).toBeEnabled();

        // Once the earlier follow-up work is done, the same edits go through.
        const retryPreview = await startCommit(page);
        await retryPreview.getByRole("button", { name: "수정 확정", exact: true }).click();
        await expect(retryPreview).toBeHidden();
        await expect(commitButton(page)).toHaveCount(0);
        await expect(page.locator('[data-slot="commit-error"]')).toHaveCount(0);
        expect(evidence.writeSteps()).toEqual(["start", "preview", "confirm", "discard", "start", "preview", "confirm"]);
        evidence.assertSafe();
    });
}

test("a case change announced on the event stream blocks the editor until it is refreshed", async ({ page }) => {
    const evidence = await installMocks(page);
    await openEditor(page);
    await stageNote(page, "다른 관리자가 먼저 확정");
    await evidence.announceCaseChange(8);
    const refreshModal = page.getByRole("dialog", { name: REFRESH_MODAL_TITLE });
    await expect(refreshModal).toBeVisible();
    await refreshModal.getByRole("button", { name: "확인", exact: true }).click();
    await expect(refreshModal).toBeHidden();
    await expect(page.locator('[data-slot="day"]').filter({ hasText: "초안 변경" })).toHaveCount(0);
    await expect(commitButton(page)).toHaveCount(0);
    expect(evidence.writeSteps()).toEqual([]);
    evidence.assertSafe();
});

test("mobile date editing uses a bottom sheet and cancellation leaves data unchanged", async ({ page }, testInfo: TestInfo) => {
    const evidence = await installMocks(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await openEditor(page);
    await openDay(page, 1);
    await page.locator('[data-component$="_body_date-edit"]').click();
    const dialog = page.getByRole("dialog", { name: "1회차 서비스 제공일 수정" });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeCloseTo(0, 0);
    expect(bounds!.width).toBeCloseTo(375, 0);
    expect(bounds!.y + bounds!.height).toBeCloseTo(812, 0);
    await expect(dialog.getByRole("combobox", { name: "일" })).toHaveCSS("height", "54px");
    await page.screenshot({ path: testInfo.outputPath("admin-mobile-date-sheet.png"), fullPage: true });
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "확인", exact: true })).toBeVisible();
    expect(evidence.requests.filter((request) => request.method !== "GET")).toHaveLength(0);
    evidence.assertSafe();
});
