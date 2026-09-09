import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

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
    "2026-07-17",
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

type MockOptions = {
    initialDraft?: DraftState;
    conflictOnNextSave?: boolean;
    generationFailure?: boolean;
};

type MockEvidence = {
    state: DraftState;
    requests: Array<{ method: string; pathname: string; body: unknown }>;
    unsafeRequests: string[];
    unhandledApiRequests: string[];
    assertSafe: () => void;
};

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function shiftBusinessDays(isoDate: string, offset: number): string {
    const current = new Date(`${isoDate}T00:00:00.000Z`);
    const direction = offset < 0 ? -1 : 1;
    let remaining = Math.abs(offset);
    while (remaining > 0) {
        current.setUTCDate(current.getUTCDate() + direction);
        const weekday = current.getUTCDay();
        if (weekday !== 0 && weekday !== 6) remaining -= 1;
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
        const weekday = start.getUTCDay();
        if (weekday !== 0 && weekday !== 6) distance += direction;
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

function mergeChanges(
    current: Draft["changes"],
    incoming: Draft["changes"],
    dateMove?: { sessionIndex: number; toDate: string },
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
        before: { startDate: plannedDates[0], endDate: "2026-07-17", sessions: before },
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
    const state = clone(options.initialDraft ?? makeDraftState());
    const requests: MockEvidence["requests"] = [];
    const unsafeRequests: string[] = [];
    const unhandledApiRequests: string[] = [];
    let conflictOnNextSave = options.conflictOnNextSave === true;
    let generationFailure = options.generationFailure === true;
    let conflictOnConfirm = false;
    let previewSequence = 0;

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
            return json(route, 200, makeOverview());
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
                dateMove?: { sessionIndex: number; toDate: string };
            };
            if (conflictOnNextSave) {
                conflictOnNextSave = false;
                const latest = makeDraftState({ sessions: [{ sessionIndex: 1, notes: "서버 최신 입력" }] }, state.draft.draftVersion + 1);
                return json(route, 409, {
                    code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT",
                    latestDraft: latest.draft,
                    sourceChanged: true,
                    sourceCaseVersion: latest.sourceCaseVersion,
                    sourceFingerprint: latest.sourceFingerprint,
                });
            }
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
        if (pathname === `/api/admin/service-records/drafts/${DRAFT_ID}/confirm` && method === "POST") {
            if (!state.draft) return json(route, 404, { code: "DRAFT_NOT_FOUND" });
            if (conflictOnConfirm) {
                conflictOnConfirm = false;
                return json(route, 409, { code: "STALE_PREVIEW" });
            }
            return json(route, 200, confirmResponse(state, generationFailure));
        }
        unhandledApiRequests.push(`${method} ${pathname}`);
        return route.abort();
    });

    const evidence: MockEvidence = {
        state,
        requests,
        unsafeRequests,
        unhandledApiRequests,
        assertSafe: () => {
            expect(unhandledApiRequests, "unexpected API route").toEqual([]);
            expect(unsafeRequests, "live auth/vendor/external request").toEqual([]);
        },
    };
    // Keep these controls available to tests without exposing a public app
    // hook. The fixture itself remains the only stateful boundary.
    Object.defineProperty(evidence, "setConfirmConflict", {
        value: () => { conflictOnConfirm = true; },
        enumerable: false,
    });
    Object.defineProperty(evidence, "setGenerationFailure", {
        value: (value: boolean) => { generationFailure = value; },
        enumerable: false,
    });
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
    await page.getByRole("button", { name: "다음" }).click();
    await page.getByRole("button", { name: "다음" }).click();
}

async function applyDateMove(page: Page, day: string): Promise<void> {
    await page.getByRole("button", { name: /제공일 변경/ }).click();
    const dialog = page.getByRole("dialog", { name: "서비스 제공일 변경" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "일" }).click();
    // Radix renders the listbox in a document-level portal, outside the
    // dialog subtree.
    await page.getByRole("option", { name: `${Number(day)}일` }).click();
    await dialog.getByRole("button", { name: "날짜 적용" }).click();
    await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
    await enableLocalAdminAuth(page);
});

test("admin direct Step 3 renders all dates and 14 fields, then preserves original/revised date and content", async ({ page }, testInfo: TestInfo) => {
    const evidence = await installMocks(page, { initialDraft: makeDraftState() });
    await openEditor(page);
    await openDay(page, 1);

    expect(await page.locator('[data-component="desktop_service-record-admin_wizard_body_day-field"]').count()).toBe(5);
    await applyDateMove(page, "20");
    await expect(page.locator('[data-component="desktop_service-record-admin_wizard_body_date-chip_date-display"]')).toContainText("2026.07.20");
    await expect(page.locator('[data-component="desktop_service-record-admin_wizard_body_date-chip_date-display"]')).toContainText("원본 2026.07.01");

    await page.getByRole("button", { name: "다음" }).click();
    expect(await page.locator('[data-component="desktop_service-record-admin_wizard_body_day-field"]').count()).toBe(6);
    await page.getByLabel("체온").fill("36.7");
    await page.getByRole("button", { name: "다음" }).click();
    expect(await page.locator('[data-component="desktop_service-record-admin_wizard_body_day-field"]').count()).toBe(3);
    await page.getByPlaceholder("서비스 제공 관련 특이사항 기록 필요 시 기재").fill("Phase6 관리자 메모");
    await page.getByRole("button", { name: "다음" }).click();
    await expect(page.locator('[data-component$="_body_review_section"]')).toHaveCount(3);
    await expect(page.locator('[data-component$="_body_review_section_row"], [data-component$="_body_review_section_note"]')).toHaveCount(14);
    await expect(page.getByRole("img", { name: "산모 서명" })).toHaveAttribute("src", /phase6-signature/);

    await page.locator('[data-component="desktop_service-record-admin_wizard_top-bar_admin-toolbar_save"]').click();
    await expect(page.getByText("저장됨")).toBeVisible();
    await expect.poll(() => evidence.requests.filter((request) => request.method === "PATCH").length).toBe(2);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-slot="day"]').nth(0)).toContainText("2026.07.20");
    await page.screenshot({ path: testInfo.outputPath("phase6-admin-desktop-overview.png"), fullPage: true });
    await openDay(page, 1);
    await goToServicePage(page);
    await expect(page.getByPlaceholder("서비스 제공 관련 특이사항 기록 필요 시 기재")).toHaveValue("Phase6 관리자 메모");
    await page.screenshot({ path: testInfo.outputPath("phase6-admin-desktop.png"), fullPage: true });
    evidence.assertSafe();
});

test("durable draft save and resume leads to preview and one confirmed result", async ({ page }) => {
    const evidence = await installMocks(page, { initialDraft: { ...makeDraftState(), draft: null } });
    await openEditor(page);
    await page.locator('[data-component="desktop_service-record-admin_wizard_top-bar_admin-toolbar_save"]').click();
    await expect(page.getByText("저장됨")).toBeVisible();
    await openDay(page, 1);
    await goToServicePage(page);
    await page.getByPlaceholder("서비스 제공 관련 특이사항 기록 필요 시 기재").fill("재개된 초안 메모");
    await page.locator('[data-component="desktop_service-record-admin_wizard_top-bar_admin-toolbar_save"]').click();
    await expect(page.getByText("저장됨")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await openDay(page, 1);
    await goToServicePage(page);
    await expect(page.getByPlaceholder("서비스 제공 관련 특이사항 기록 필요 시 기재")).toHaveValue("재개된 초안 메모");
    await page.getByRole("button", { name: "변경 미리보기" }).click();
    const preview = page.getByRole("dialog", { name: "초안 변경 미리보기" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("변경 전");
    await preview.getByRole("button", { name: "수정 확정" }).click();
    await expect(page.getByText("수정 확정됨").first()).toBeVisible();
    await expect(page.getByText("전자문서 처리 대기 중").first()).toBeVisible();
    await expect(preview.getByRole("button", { name: "수정 확정됨" })).toBeDisabled();
    evidence.assertSafe();
});

test("a draft conflict retains local edits and requires an explicit fresh preview", async ({ page }) => {
    const evidence = await installMocks(page, {
        initialDraft: makeDraftState({ sessions: [{ sessionIndex: 1, notes: "기존 초안" }] }),
        conflictOnNextSave: true,
    });
    await openEditor(page);
    await openDay(page, 1);
    await goToServicePage(page);
    const notes = page.getByPlaceholder("서비스 제공 관련 특이사항 기록 필요 시 기재");
    await notes.fill("내 입력 보존");
    await page.locator('[data-component="desktop_service-record-admin_wizard_top-bar_admin-toolbar_save"]').click();
    await expect(page.getByText(/다른 관리자의 변경으로 저장되지 않았습니다/)).toBeVisible();
    await expect(notes).toHaveValue("내 입력 보존");
    await page.getByRole("button", { name: "내 입력 유지" }).click();
    await page.getByRole("button", { name: "변경 미리보기" }).click();
    await expect(page.getByRole("dialog", { name: "초안 변경 미리보기" })).toBeVisible();
    await expect.poll(() => evidence.requests.filter((request) => request.method === "PATCH").length).toBe(2);
    evidence.assertSafe();
});

test("generation failure remains an explicit unverified document status without false completion", async ({ page }) => {
    const evidence = await installMocks(page, {
        initialDraft: makeDraftState({ sessions: [{ sessionIndex: 1, notes: "문서 처리 확인" }] }),
        generationFailure: true,
    });
    await openEditor(page);
    await page.getByRole("button", { name: "변경 미리보기" }).click();
    const preview = page.getByRole("dialog", { name: "초안 변경 미리보기" });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "수정 확정" }).click();
    await expect(page.getByText("수정 확정됨").first()).toBeVisible();
    await expect(page.getByText("전자문서 처리 근거 확인 필요").first()).toBeVisible();
    await expect(page.getByText("전자문서 처리 완료")).toHaveCount(0);
    evidence.assertSafe();
});

test("a stale confirm keeps the draft and offers a fresh preview without another unsafe route", async ({ page }) => {
    const evidence = await installMocks(page, { initialDraft: makeDraftState({ sessions: [{ sessionIndex: 1, notes: "재확인 필요" }] }) });
    const setConfirmConflict = (evidence as MockEvidence & { setConfirmConflict: () => void }).setConfirmConflict;
    setConfirmConflict();
    await openEditor(page);
    await page.getByRole("button", { name: "변경 미리보기" }).click();
    const preview = page.getByRole("dialog", { name: "초안 변경 미리보기" });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "수정 확정" }).click();
    await expect(page.getByText(/미리보기가 오래되어 수정 확정에 실패했습니다/)).toBeVisible();
    await expect(page.getByRole("button", { name: "최신 미리보기" })).toBeVisible();
    await page.getByRole("button", { name: "최신 미리보기" }).click();
    await expect(page.getByRole("dialog", { name: "초안 변경 미리보기" })).toBeVisible();
    expect(evidence.requests.filter((request) => request.pathname.endsWith("/confirm")).length).toBe(1);
    expect(evidence.requests.filter((request) => request.pathname.endsWith("/preview")).length).toBe(2);
    evidence.assertSafe();
});

test("the admin wizard retains original/revised dates at a narrow mobile viewport", async ({ page }, testInfo: TestInfo) => {
    const evidence = await installMocks(page, {
        initialDraft: makeDraftState({ sessions: [{ sessionIndex: 1, serviceDate: "2026-07-20" }] }),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await openDay(page, 1);
    await expect(page.locator('[data-component="desktop_service-record-admin_wizard_body_date-chip_date-display"]')).toContainText("2026.07.20");
    await expect(page.locator('[data-component="desktop_service-record-admin_wizard_body_date-chip_date-display"]')).toContainText("원본 2026.07.01");
    await page.screenshot({ path: testInfo.outputPath("phase6-admin-mobile-390.png"), fullPage: true });
    evidence.assertSafe();
});
