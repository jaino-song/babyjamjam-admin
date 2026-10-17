import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { serviceRecordSignatureFingerprint } from "application/utils/service-record-signature-fingerprint";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import {
    ServiceRecordEditConflictError,
    ServiceRecordRevisionOperationUnresolvedError,
} from "domain/errors/service-record-edit.error";
import { KOREAN_HOLIDAY_CALENDAR, createKrBusinessDayCalendar, type KrBusinessDayCalendar } from "domain/utils/business-days";
import type {
    ServiceRecordEditRevisionFactsSource,
    ServiceRecordEditSource,
    ServiceRecordEditConfirmPlan,
} from "domain/repositories/service-record-edit.repository.interface";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = 101;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sourceSnapshot(overrides: Record<string, unknown> = {}): ServiceRecordEditSource {
    return {
        caseId: CASE_ID,
        caseVersion: 7,
        formVersion: 3,
        requiredSessionCount: 3,
        startDate: "2026-09-01",
        endDate: "2026-09-15",
        header: {
            momName: "산모",
            momBirth: "900101",
            babyName: "아기",
            babyBirth: "260901",
            deliveryType: "자연분만",
            babyWeight: "3.2",
        },
        sessions: [
            {
                id: "day-1",
                branchId: BRANCH_ID,
                sourceRowId: "day-1",
                scheduleId: 55,
                sessionIndex: 1,
                rawCaseSessionIndex: 1,
                rawSessionIndex: 1,
                ambiguous: false,
                serviceDate: "2026-09-01",
                answers: { perineum: ["이상없음"] },
                etcService: null,
                notes: null,
                paymentConfirmed: false,
                momApproval: "approved",
                clientSignature: "data:image/png;base64,aGVsbG8=",
                clientSignedAt: "2026-09-01T03:00:00.000Z",
                locked: true,
                submittedAt: "2026-09-01T04:00:00.000Z",
                employeeId: 9,
                employeeNameSnapshot: "제공자",
                formVersion: 3,
            },
        ],
        assignments: [{
            id: null,
            branchId: BRANCH_ID,
            serviceRecordCaseId: CASE_ID,
            scheduleId: 55,
            employeeId: 9,
            startDate: "2026-09-01",
            endDate: "2026-09-15",
            replaced: false,
            employeeName: "제공자",
            scheduleStartDate: "2026-09-01",
            scheduleEndDate: "2026-09-15",
            scheduleTerminatedAt: null,
            primaryEmployeeId: 9,
            secondaryEmployeeId: null,
            primaryEmployeeName: "제공자",
        }],
        plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-01" }],
        client: {
            id: CLIENT_ID,
            branchId: BRANCH_ID,
            name: "산모",
            duration: 10,
            startDate: "2026-09-01",
            endDate: "2026-09-15",
            serviceStatus: "in_progress",
        },
        ...overrides,
    } as unknown as ServiceRecordEditSource;
}

function draft(overrides: Record<string, unknown> = {}) {
    return {
        id: DRAFT_ID,
        branchId: BRANCH_ID,
        serviceRecordCaseId: CASE_ID,
        createdByUserId: ACTOR_ID,
        updatedByUserId: ACTOR_ID,
        discardedByUserId: null,
        sourceCaseVersion: 7,
        sourceFingerprint: "source-fingerprint",
        sourceSnapshot: { caseId: CASE_ID, caseVersion: 7 },
        changes: { header: { momName: "수정 산모" } },
        draftVersion: 1,
        status: "ACTIVE",
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
        updatedAt: new Date("2026-09-08T00:00:00.000Z"),
        discardedAt: null,
        ...overrides,
    };
}

function previewSourceSnapshot(): ServiceRecordEditSource {
    const base = sourceSnapshot();
    const assignmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const assignment = { ...base.assignments[0]!, id: assignmentId };
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03"];
    return {
        ...base,
        caseLifecycle: {
            status: "IN_PROGRESS",
            completedAt: null,
            finalizationDueAt: null,
            finalizationStartedAt: null,
            finalizedAt: null,
            documentsCompletedAt: null,
        },
        startDate: dates[0]!,
        endDate: dates.at(-1)!,
        assignments: [assignment],
        plannedSessions: dates.map((serviceDate, index) => ({
            sessionIndex: index + 1,
            serviceDate,
            originalDate: serviceDate,
            assignmentId,
            scheduleId: assignment.scheduleId,
            employeeId: assignment.employeeId,
            provenanceVersion: "case-7",
        })),
    };
}

function observedRevisionFactsSource(): ServiceRecordEditRevisionFactsSource {
    return {
        document: {
            documentId: "contract-document-1",
            branchId: BRANCH_ID,
            clientId: CLIENT_ID,
            documentVersion: null,
            templateId: "contract-template",
            templateVersion: "v12",
            mirrorGeneration: "mirror-generation-7",
            statusType: "070",
            stepType: "06",
            stepIndex: "3",
            stepName: "표시용 단계 이름",
            stage: "provider_review",
            workflowScope: {
                statusType: "070",
                stepType: "06",
                stepIndex: "3",
                stepName: "표시용 단계 이름",
            },
            allowedFieldIds: ["이용자 성명", "계약 시작일", "계약 종료일", "서비스 기간", "본인부담금 수령일", "본인부담금"],
            detailPayload: {
                id: "contract-document-1",
                template: { id: "contract-template", name: "계약서" },
                current_status: {
                    status_type: "070",
                    step_type: "06",
                    step_index: "3",
                    step_name: "표시용 단계 이름",
                    step_recipients: [],
                },
                fields: [
                    { id: "이용자 성명", value: "산모", type: "text" },
                    { id: "계약 시작일", value: "2026-09-01", type: "date" },
                    { id: "계약 종료일", value: "2026-09-03", type: "date" },
                    { id: "서비스 기간", value: "20260901 ~ 20260903", type: "text" },
                    { id: "본인부담금 수령일", value: "2026-08-31", type: "date" },
                    { id: "본인부담금", value: "462000", type: "number" },
                ],
                recipients: [{ recipient_type: "02", id: "customer@example.com", name: "산모" }],
            },
        },
        receiptTokens: [],
    };
}

function completeSourceSnapshot(): ServiceRecordEditSource {
    const base = previewSourceSnapshot();
    const assignment = base.assignments[0]!;
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03"];
    return {
        ...base,
        caseLifecycle: {
            status: "READY_TO_FINALIZE",
            completedAt: null,
            finalizationDueAt: null,
            finalizationStartedAt: null,
            finalizedAt: null,
            documentsCompletedAt: null,
        },
        startDate: dates[0]!,
        endDate: dates.at(-1)!,
        sessions: dates.map((serviceDate, index) => ({
            ...base.sessions[0]!,
            id: `day-${index + 1}`,
            sourceRowId: `day-${index + 1}`,
            sessionIndex: index + 1,
            rawCaseSessionIndex: index + 1,
            rawSessionIndex: index + 1,
            serviceDate,
            ambiguous: false,
        })),
        plannedSessions: dates.map((serviceDate, index) => ({
            sessionIndex: index + 1,
            serviceDate,
            originalDate: serviceDate,
            assignmentId: assignment.id,
            scheduleId: assignment.scheduleId,
            employeeId: assignment.employeeId,
            provenanceVersion: "case-7",
        })),
    };
}

function realisticAnswers() {
    return {
        perineum: ["이상없음"],
        breast: ["이상없음"],
        excretion: ["이상없음"],
        sitzBath: "실시",
        meals_meal: 3,
        meals_snack: 2,
        temperature_temp: 36.5,
        sleep: "잘 잠",
        breastFeeding_count: 4,
        formulaFeeding_count: 1,
        formulaFeeding_ml: 60,
        stool: "정상변",
        stool_color: "",
        bath: "실시",
    };
}

function createHarness(options: {
    source?: ReturnType<typeof sourceSnapshot> | null;
    activeDraft?: ReturnType<typeof draft> | null;
    targetDraft?: { serviceRecordCaseId: string } | null;
    calendar?: KrBusinessDayCalendar;
    caseEventBus?: { emit: jest.Mock };
} = {}) {
    const repository = {
        createOrResumeDraft: jest.fn().mockImplementation((input: { sourceFingerprint: string; sourceSnapshot: unknown; changes?: unknown }) => Promise.resolve(draft({
            sourceFingerprint: input.sourceFingerprint,
            sourceSnapshot: input.sourceSnapshot,
            changes: input.changes ?? {},
        }))),
        findActiveDraft: jest.fn().mockResolvedValue(options.activeDraft ?? null),
        findDraft: jest.fn().mockResolvedValue(options.activeDraft ?? draft()),
        findDraftById: jest.fn().mockResolvedValue(options.targetDraft ?? { serviceRecordCaseId: CASE_ID }),
        loadSource: jest.fn().mockResolvedValue(options.source ?? sourceSnapshot()),
        updateDraft: jest.fn().mockResolvedValue(draft({
            draftVersion: 2,
            changes: { header: { momName: "저장됨" } },
        })),
        discardDraft: jest.fn().mockResolvedValue(draft({ status: "DISCARDED", draftVersion: 2 })),
        confirmDraft: jest.fn(),
    };
    const holidayCalendar = createHolidayCalendarStub();
    const { calendar } = options;
    if (calendar) (holidayCalendar.forBranch as jest.Mock).mockImplementation(async () => calendar);
    const service = new AdminServiceRecordEditService(
        repository as never,
        holidayCalendar,
        options.caseEventBus as never,
    );
    return { service, repository, holidayCalendar };
}

describe("AdminServiceRecordEditService", () => {
    it("captures a realistic 14-field payload without mutating source provenance", async () => {
        const harness = createHarness();
        const changes = {
            header: { momName: "수정산모" },
            sessions: [{
                sessionIndex: 1,
                serviceDate: "2026-09-01",
                answers: realisticAnswers(),
                etcService: "수유 자세 안내",
                notes: "특이사항 없음",
                paymentConfirmed: true,
            }],
        };

        const result = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, { changes });

        expect(result).toMatchObject({ draft: { id: DRAFT_ID }, sourceChanged: false, sourceCaseVersion: 7 });
        expect(harness.repository.createOrResumeDraft).toHaveBeenCalledWith(expect.objectContaining({
            branchId: BRANCH_ID,
            serviceRecordCaseId: CASE_ID,
            actorUserId: ACTOR_ID,
            sourceCaseVersion: 7,
            sourceFingerprint: expect.any(String),
            sourceSnapshot: expect.objectContaining({
                caseId: CASE_ID,
                sessions: expect.arrayContaining([
                    expect.objectContaining({
                        branchId: BRANCH_ID,
                        sourceRowId: "day-1",
                        rawCaseSessionIndex: 1,
                        rawSessionIndex: 1,
                        employeeNameSnapshot: "제공자",
                        formVersion: 3,
                        clientSignature: "data:image/png;base64,aGVsbG8=",
                        submittedAt: "2026-09-01T04:00:00.000Z",
                    }),
                ]),
            }),
            changes: expect.objectContaining({ sessions: expect.any(Array) }),
        }));
    });

    it("reads without creating and marks a resumed draft when the source fingerprint changed", async () => {
        const active = draft({ sourceFingerprint: "old-source" });
        const harness = createHarness({ activeDraft: active });

        const result = await harness.service.getDraft(BRANCH_ID, CLIENT_ID);

        expect(result).toMatchObject({ draft: active, sourceChanged: true, sourceCaseVersion: 7 });
        expect(harness.repository.findActiveDraft).toHaveBeenCalledWith(BRANCH_ID, CASE_ID);
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();
    });

    it("reports sourceChanged on POST resume without rebasing the stored snapshot", async () => {
        const active = draft({ sourceFingerprint: "old-source", sourceSnapshot: { original: true } });
        const harness = createHarness({ activeDraft: active });
        harness.repository.createOrResumeDraft.mockResolvedValue(active);

        const result = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { momName: "새입력" } },
        });

        expect(result).toMatchObject({ draft: active, sourceChanged: true });
        expect(result.draft?.sourceSnapshot).toEqual(active.sourceSnapshot);
        expect(harness.repository.createOrResumeDraft).toHaveBeenCalledWith(expect.objectContaining({
            sourceSnapshot: expect.objectContaining({ caseId: CASE_ID }),
            sourceFingerprint: expect.any(String),
        }));
        expect((harness.repository.createOrResumeDraft.mock.calls[0]?.[0] as { sourceSnapshot: unknown }).sourceSnapshot)
            .not.toEqual(active.sourceSnapshot);
    });

    it("includes client period and raw schedule facts in the source fingerprint", async () => {
        const harness = createHarness();
        const first = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        const persisted = first.draft;
        if (!persisted) throw new Error("expected a draft");
        harness.repository.findActiveDraft.mockResolvedValue(persisted);
        const changedSource = sourceSnapshot();
        changedSource.client = {
            ...changedSource.client,
            duration: 11,
            endDate: "2026-09-16",
        };
        changedSource.assignments = [{
            ...changedSource.assignments[0]!,
            scheduleStartDate: "2026-09-02",
            scheduleEndDate: "2026-09-16",
        }];
        harness.repository.loadSource.mockResolvedValue(changedSource);

        const result = await harness.service.getDraft(BRANCH_ID, CLIENT_ID);

        expect(result.sourceChanged).toBe(true);
    });

    it("tracks client renames while ignoring lifecycle-only status and version changes", async () => {
        const harness = createHarness();
        const first = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        const persisted = first.draft;
        if (!persisted) throw new Error("expected a draft");
        harness.repository.findActiveDraft.mockResolvedValue(persisted);

        const baseline = sourceSnapshot();
        harness.repository.loadSource.mockResolvedValue({
            ...baseline,
            client: { ...baseline.client, name: "이름 변경" },
        });
        await expect(harness.service.getDraft(BRANCH_ID, CLIENT_ID)).resolves.toMatchObject({ sourceChanged: true });

        harness.repository.loadSource.mockResolvedValue({
            ...baseline,
            caseVersion: baseline.caseVersion + 1,
            client: { ...baseline.client, serviceStatus: "completed" },
        });
        await expect(harness.service.getDraft(BRANCH_ID, CLIENT_ID)).resolves.toMatchObject({ sourceChanged: false });
    });

    it.each([
        ["meals_meal", "1.5"],
        ["temperature_temp", "36.75"],
        ["meals_meal", "NaN"],
    ])("rejects invalid numeric draft answer %s=%s before persistence", async (key, value) => {
        const harness = createHarness();

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: {
                sessions: [{
                    sessionIndex: 1,
                    answers: { [key]: value },
                }],
            },
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();
    });

    it.each([
        ["momBirth", "260230", "SERVICE_RECORD_HEADER_DATE_INVALID"],
        ["babyBirth", "2402290", "SERVICE_RECORD_HEADER_DATE_INVALID"],
        ["babyWeight", "-1", "SERVICE_RECORD_HEADER_WEIGHT_INVALID"],
        ["babyWeight", "0", "SERVICE_RECORD_HEADER_WEIGHT_INVALID"],
        ["babyWeight", "0.0", "SERVICE_RECORD_HEADER_WEIGHT_INVALID"],
        ["babyWeight", "NaN", "SERVICE_RECORD_HEADER_WEIGHT_INVALID"],
        ["babyWeight", "Infinity", "SERVICE_RECORD_HEADER_WEIGHT_INVALID"],
        ["babyWeight", "0x10", "SERVICE_RECORD_HEADER_WEIGHT_INVALID"],
        ["babyWeight", "1e2", "SERVICE_RECORD_HEADER_WEIGHT_INVALID"],
    ] as const)("rejects invalid changed header %s=%s before persistence", async (key, value, code) => {
        const harness = createHarness();

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { [key]: value } },
        })).rejects.toMatchObject({ response: { code } });
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();
    });

    it("accepts valid leap-day dates and finite positive decimal weights", async () => {
        const harness = createHarness();

        await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { momBirth: "240229", babyBirth: "240229", babyWeight: "3.2" } },
        });

        expect(harness.repository.createOrResumeDraft).toHaveBeenCalledWith(expect.objectContaining({
            changes: { header: { momBirth: "240229", babyBirth: "240229", babyWeight: "3.2" } },
        }));
    });

    it("persists a valid ISO birthday updateDraft with only the edited fields in the patch", async () => {
        const harness = createHarness();

        const result = await harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: { header: { momBirth: "1990-01-01", babyBirth: "2026-07-14" } },
        });

        expect(result.draft).toMatchObject({ id: DRAFT_ID, status: "ACTIVE" });
        // The patch carries exactly the edited ISO fields; the untouched
        // historic six-digit source values are never revalidated or included.
        expect(harness.repository.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
            changes: { header: { momBirth: "1990-01-01", babyBirth: "2026-07-14" } },
        }));
    });

    it("persists ISO leap-day birthday writes without rewriting them", async () => {
        const source = sourceSnapshot({
            header: { ...sourceSnapshot().header, momBirth: "1990-01-01", babyBirth: "2024-02-29" },
        });
        const harness = createHarness({ source });

        await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { momBirth: "2024-02-29" } },
        });

        expect(harness.repository.createOrResumeDraft).toHaveBeenCalledWith(expect.objectContaining({
            changes: { header: { momBirth: "2024-02-29" } },
        }));
    });

    it.each([
        ["momBirth", "2023-02-29"], // impossible leap day
        ["momBirth", "2026-02-30"], // impossible calendar day
        ["momBirth", "2999-12-31"], // future date
        ["momBirth", "1990-1-1"], // malformed separator shape
        ["momBirth", "19900101"], // eight digits are not an ISO birthday
        ["momBirth", " 1990-01-01"], // padded value must not be trimmed into a valid one
        ["babyBirth", "2023-02-29"],
        ["babyBirth", "2999-12-31"],
    ] as const)("rejects invalid ISO %s=%s with the structured date code", async (key, value) => {
        const harness = createHarness();

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { [key]: value } },
        })).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_HEADER_DATE_INVALID" } });
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();
    });

    it("keeps legacy six-digit birthday writes valid while ISO writes are introduced", async () => {
        const harness = createHarness();

        await harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: { header: { babyBirth: "260615" } },
        });

        expect(harness.repository.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
            changes: { header: { babyBirth: "260615" } },
        }));
    });

    it("preserves untouched historic header fields on a name-only edit", async () => {
        const harness = createHarness();

        await harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: { header: { momName: "새산모" } },
        });

        expect(harness.repository.updateDraft).toHaveBeenCalledWith(expect.objectContaining({
            changes: { header: { momName: "새산모" } },
        }));
        const call = harness.repository.updateDraft.mock.calls[0]?.[0] as { changes: { header: Record<string, unknown> } };
        expect(Object.keys(call.changes.header)).toEqual(["momName"]);
    });

    it.each([
        ["momName", "김 산모"],
        ["babyName", "김 아기"],
        ["deliveryType", "수압분만"],
    ] as const)("rejects invalid new %s=%s with a structured header code", async (key, value) => {
        const harness = createHarness();

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { [key]: value } },
        })).rejects.toMatchObject({ response: {
            code: key === "deliveryType" ? "SERVICE_RECORD_HEADER_DELIVERY_TYPE_INVALID" : "SERVICE_RECORD_HEADER_NAME_INVALID",
        } });
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();
    });

    it("keeps blank header values and session-only partial patches compatible", async () => {
        const blankHeaderHarness = createHarness();
        await blankHeaderHarness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { momBirth: "", babyBirth: " ", babyWeight: "" } },
        });
        expect(blankHeaderHarness.repository.createOrResumeDraft).toHaveBeenCalledWith(expect.objectContaining({
            changes: { header: { momBirth: "", babyBirth: "", babyWeight: "" } },
        }));

        const legacySource = sourceSnapshot({
            header: { ...sourceSnapshot().header, babyBirth: "2026-09-01", babyWeight: "Infinity" },
        });
        const sessionOnlyHarness = createHarness({ source: legacySource });
        await sessionOnlyHarness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { sessions: [{ sessionIndex: 1, notes: "회차 메모" }] },
        });
        expect(sessionOnlyHarness.repository.createOrResumeDraft).toHaveBeenCalled();
    });

    it("rejects invalid header updates before the repository update and omits the raw value", async () => {
        const harness = createHarness();

        await expect(harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: { header: { babyBirth: "260230" } },
        })).rejects.toMatchObject({ response: {
            code: "SERVICE_RECORD_HEADER_DATE_INVALID",
            message: expect.not.stringContaining("260230"),
        } });
        expect(harness.repository.updateDraft).not.toHaveBeenCalled();
    });

    it("rejects authority fields, duplicate sessions, and invalid dates before persistence", async () => {
        const harness = createHarness();
        const forbidden = {
            branchId: "attacker-branch",
            sessions: [{ sessionIndex: 1, serviceDate: "2026-02-30" }],
        };

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: forbidden as never,
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                code: "VALIDATION_FAILED",
                errors: [expect.objectContaining({
                    pointer: "/changes/branchId",
                    code: "UNEXPECTED_FIELD",
                })],
            }),
        });
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: {
                sessions: [
                    { sessionIndex: 1, serviceDate: "2026-09-01" },
                    { sessionIndex: 1, serviceDate: "2026-09-02" },
                ],
            },
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                code: "VALIDATION_FAILED",
                errors: [expect.objectContaining({
                    pointer: "/changes/sessions",
                    code: "INVALID_VALUE",
                })],
            }),
        });
    });

    it("returns the latest safe draft state as a 409 on stale CAS", async () => {
        const active = draft({ sourceFingerprint: "old-source" });
        const latest = draft({ draftVersion: 2, changes: { header: { momName: "다른 관리자" } } });
        const harness = createHarness({ activeDraft: active });
        harness.repository.updateDraft.mockRejectedValue(new ServiceRecordEditConflictError());
        harness.repository.findDraft.mockResolvedValue(latest);

        const operation = harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: { header: { momName: "내저장" } },
        });
        await expect(operation).rejects.toBeInstanceOf(ConflictException);
        await expect(operation).rejects.toMatchObject({
            response: expect.objectContaining({
                code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
                latestDraft: latest,
                sourceChanged: true,
            }),
        });
    });

    it("returns 404 for a draft whose case is not present in the requested branch", async () => {
        const harness = createHarness({ targetDraft: null });
        harness.repository.findDraftById.mockResolvedValue(null);

        await expect(harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: {},
        })).rejects.toBeInstanceOf(NotFoundException);
        expect(harness.repository.updateDraft).not.toHaveBeenCalled();
    });

    it("does not create a draft when the client or case is outside the tenant branch", async () => {
        const harness = createHarness();
        harness.repository.loadSource.mockResolvedValue(null);

        await expect(harness.service.startDraft(BRANCH_ID, 999, ACTOR_ID, {})).rejects.toBeInstanceOf(NotFoundException);
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();

        await expect(harness.service.getDraft(BRANCH_ID, CLIENT_ID)).rejects.toBeInstanceOf(NotFoundException);
        expect(harness.repository.findActiveDraft).not.toHaveBeenCalled();
    });

    it("rejects editing a session target when canonical and legacy rows are ambiguous", async () => {
        const baseSource = sourceSnapshot();
        const ambiguousSource = sourceSnapshot({
            sessions: [
                baseSource.sessions[0],
                {
                    ...baseSource.sessions[0]!,
                    id: "day-legacy-1",
                    sourceRowId: "day-legacy-1",
                    rawCaseSessionIndex: null,
                    sessionIndex: 1,
                    ambiguous: true,
                    serviceDate: "2026-09-02",
                    answers: { breast: ["울혈"] },
                },
            ],
        });
        const harness = createHarness({ source: ambiguousSource });

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { sessions: [{ sessionIndex: 1, notes: "수정" }] },
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                code: "VALIDATION_FAILED",
                errors: [expect.objectContaining({
                    pointer: "/changes/sessions",
                    code: "INVALID_VALUE",
                })],
            }),
        });
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();
    });

    it("rechecks the linked client branch when a draft resolves by case id", async () => {
        const harness = createHarness();
        harness.repository.loadSource.mockResolvedValue(null);

        await expect(harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: { header: { momName: "수정" } },
        })).rejects.toBeInstanceOf(NotFoundException);
        expect(harness.repository.updateDraft).not.toHaveBeenCalled();
    });

    it("builds a read-only preview from the full authoritative planned vector", async () => {
        const harness = createHarness({ source: previewSourceSnapshot() });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: { sessions: [{ sessionIndex: 2, notes: "수정" }] },
        };
        const atomicRepository = harness.repository as typeof harness.repository & { loadDraftWithSource: jest.Mock };
        atomicRepository.loadDraftWithSource = jest.fn().mockResolvedValue({
            draft: activeDraft,
            source: previewSourceSnapshot(),
        });
        harness.repository.findDraftById.mockResolvedValue(activeDraft);

        const result = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });

        expect(result.previewId).toMatch(/^srp_[a-f0-9]{64}$/);
        expect(result.draftId).toBe(DRAFT_ID);
        expect(result.draftVersion).toBe(1);
        expect(result.requiredSessionCount).toBe(3);
        expect(result.before.sessions).toHaveLength(3);
        expect(result.after.sessions).toHaveLength(3);
        expect(result.contentChanges.changedSessionIndexes).toEqual([2]);
        expect(result.blockingReasons).toEqual([]);
        expect(harness.repository.updateDraft).not.toHaveBeenCalled();
        expect(atomicRepository.loadDraftWithSource).toHaveBeenCalledWith(BRANCH_ID, DRAFT_ID);
        expect(harness.repository.findDraftById).not.toHaveBeenCalled();
        expect(harness.repository.loadSource).toHaveBeenCalledTimes(1);
    });

    it("merges sparse session answer patches into the immutable confirmation row", async () => {
        const source = previewSourceSnapshot();
        source.sessions[0] = {
            ...source.sessions[0]!,
            answers: {
                perineum: ["이상없음"],
                breast: ["울혈"],
            },
        };
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: {
                sessions: [{
                    sessionIndex: 1,
                    answers: { breast: ["이상없음"] },
                }],
            },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });

        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });

        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source }) as ServiceRecordEditConfirmPlan;
        const bytesHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
        // Pinned against this pre-existing fixture before introducing beforeSnapshot.
        expect({
            revisionPayload: bytesHash(plan.revision?.payload),
            revisionFingerprint: plan.documentJob?.payloadFingerprint,
            documentJobPayload: bytesHash(plan.documentJob?.payload),
            contractImmutableInput: bytesHash(plan.contractOperation?.immutableInput),
            receiptImmutableInput: bytesHash(plan.receiptOperation?.immutableInput),
        }).toEqual({
            contractImmutableInput: "17522468ae55ca34c4a75644631d5def376e3ba6d17023965d28ee86f0974602",
            documentJobPayload: "a2a5a37767da82212f44ecb021f3c0f05cc7447e48fcb54a16c4b2ae48c41292",
            receiptImmutableInput: "7938134c25809346905c0be4772af31ec247830138aa11310e0b0c82edb7e5f1",
            revisionFingerprint: "4f5a18231965c321cbfa2136e70b3902abd48da3a09fb574f7a63eecea5cae07",
            revisionPayload: "4f5a18231965c321cbfa2136e70b3902abd48da3a09fb574f7a63eecea5cae07",
        });
        expect(plan.revision?.beforeSnapshot).toEqual({
            snapshotVersion: 1,
            startDate: source.startDate,
            endDate: source.endDate,
            header: source.header,
            plannedSessions: preview.before.sessions,
            sessions: source.sessions.map((session) => ({
                sessionIndex: session.sessionIndex,
                serviceDate: session.serviceDate,
                answers: session.answers,
                etcService: session.etcService,
                notes: session.notes,
                paymentConfirmed: session.paymentConfirmed,
                employeeId: session.employeeId,
                employeeNameSnapshot: session.employeeNameSnapshot,
                clientSignatureFingerprint: serviceRecordSignatureFingerprint(session.clientSignature),
            })),
        });
        expect(JSON.stringify(plan.revision?.beforeSnapshot)).not.toContain("data:image");
        expect(plan.sessions[0]?.answers).toEqual({
            perineum: ["이상없음"],
            breast: ["이상없음"],
        });
        expect(plan.revision?.payload).toEqual(expect.objectContaining({
            sessions: expect.arrayContaining([
                expect.objectContaining({
                    sourceRowId: "day-1",
                    answers: {
                        perineum: ["이상없음"],
                        breast: ["이상없음"],
                    },
                }),
            ]),
        }));
    });

    it("treats a sparse answer patch that preserves the effective answers as a preview and confirm no-op", async () => {
        const source = previewSourceSnapshot();
        source.sessions[0] = {
            ...source.sessions[0]!,
            answers: {
                perineum: ["이상없음"],
                breast: ["울혈"],
            },
        };
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: {
                sessions: [{
                    sessionIndex: 1,
                    answers: { breast: ["울혈"] },
                }],
            },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });

        expect(preview.contentChanges.changedSessionIndexes).toEqual([]);

        harness.repository.confirmDraft.mockResolvedValue({
            status: "no_changes" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 1,
            caseVersion: 7,
            revisionId: null,
            revisionNumber: null,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "66666666-6666-4666-8666-666666666666",
        });

        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source }) as {
            status: "confirmed" | "no_changes";
            sessions: Array<Record<string, unknown>>;
            revision: unknown;
            documentJob: unknown;
        };
        expect(plan.status).toBe("no_changes");
        expect(plan.sessions[0]?.["answers"]).toEqual({
            perineum: ["이상없음"],
            breast: ["울혈"],
        });
        expect(plan.revision).toBeNull();
        expect(plan.documentJob).toBeNull();
    });

    it("plans explicit future content with canonical provenance in the immutable revision", async () => {
        const source = previewSourceSnapshot();
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: { sessions: [{ sessionIndex: 2, answers: {}, notes: "관리자 미래 메모" }] },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        const response = {
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        };
        harness.repository.confirmDraft.mockResolvedValue(response);

        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });

        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source }) as {
            status: "confirmed" | "no_changes";
            sessions: Array<Record<string, unknown>>;
            newSessions: Array<Record<string, unknown>>;
            revision: { payload: Record<string, unknown> } | null;
        };
        expect(plan.status).toBe("confirmed");
        expect(plan.sessions).toHaveLength(1);
        expect(plan.newSessions).toHaveLength(1);
        const future = plan.newSessions[0]!;
        expect(future).toMatchObject({
            sessionIndex: 2,
            serviceDate: "2026-09-02",
            originalDate: "2026-09-02",
            assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            provenanceVersion: "case-7",
            answers: {},
            etcService: null,
            notes: "관리자 미래 메모",
            paymentConfirmed: false,
            momApproval: null,
            clientSignature: null,
            clientSignedAt: null,
            locked: false,
            submittedAt: null,
            scheduleId: 55,
            employeeId: 9,
            employeeNameSnapshot: "제공자",
            formVersion: 3,
        });
        expect(future["sourceRowId"]).toEqual(expect.stringMatching(UUID_PATTERN));
        expect(plan.revision?.payload).toEqual(expect.objectContaining({
            completeness: "partial",
            sessions: expect.arrayContaining([
                expect.objectContaining({
                    sourceRowId: future["sourceRowId"],
                    sessionIndex: 2,
                    notes: "관리자 미래 메모",
                    locked: false,
                    submittedAt: null,
                    clientSignature: null,
                    clientSignedAt: null,
                    employeeId: 9,
                    scheduleId: 55,
                    formVersion: 3,
                }),
            ]),
            newSessions: expect.arrayContaining([
                expect.objectContaining({
                    sourceRowId: future["sourceRowId"],
                    sessionIndex: 2,
                    notes: "관리자 미래 메모",
                }),
            ]),
        }));
    });

    it("builds observed contract date fields on the real confirm-planner path", async () => {
        const source = previewSourceSnapshot();
        source.documentScope = {
            evidence: "observed",
            serviceRecordSnapshot: {
                documentIds: [],
                snapshotVersion: null,
                chunks: [],
            },
            currentRevision: { id: null, revisionNumber: null, formVersion: null },
            form: { version: source.formVersion },
            contract: { currentDocumentId: "contract-document-1", stage: "in_progress" },
            receipt: {
                evidence: "observed",
                eformsignDocId: null,
                tokenIds: [],
                sourceDocumentId: "contract-document-1",
            },
        };
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: { sessions: [{ sessionIndex: 3, serviceDate: "2026-09-04" }] },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });

        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });

        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: {
                draft: typeof activeDraft;
                source: ServiceRecordEditSource;
                revisionFactsSource?: ServiceRecordEditRevisionFactsSource;
            }) => unknown;
        };
        const plan = input.prepare({
            draft: activeDraft,
            source,
            revisionFactsSource: observedRevisionFactsSource(),
        }) as {
            contractOperation: {
                status: string;
                immutableInput: Record<string, unknown>;
            } | null;
        };
        expect(plan.contractOperation?.status).toBe("pending");
        expect(plan.contractOperation?.immutableInput).toEqual(expect.objectContaining({
            target: expect.objectContaining({
                startDate: "2026-09-01",
                endDate: "2026-09-04",
                receiptPeriod: "2026-09-01~2026-09-04",
                fields: {
                    "계약 시작일": "2026-09-01",
                    "계약 종료일": "2026-09-04",
                    "서비스 기간": "20260901 ~ 20260904",
                },
            }),
        }));
        const immutableInput = plan.contractOperation?.immutableInput;
        const target = immutableInput?.["target"] as Record<string, unknown> | undefined;
        expect(target?.["fields"]).not.toHaveProperty("본인부담금 수령일");
        expect(target?.["fields"]).not.toHaveProperty("본인부담금");
    });

    it.each([
        ["session-index-only", { sessions: [{ sessionIndex: 2 }] }],
        ["date-only", { sessions: [{ sessionIndex: 2, serviceDate: "2026-09-02" }] }],
        ["blank-note", { sessions: [{ sessionIndex: 2, notes: "" }] }],
    ])("keeps an ineffective future patch a no-op (%s)", async (_label, changes) => {
        const source = previewSourceSnapshot();
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = { ...started.draft, changes };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });
        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source }) as {
            status: "confirmed" | "no_changes";
            newSessions: Array<Record<string, unknown>>;
            revision: unknown;
        };
        expect(plan.status).toBe("no_changes");
        expect(plan.newSessions).toEqual([]);
        expect(plan.revision).toBeNull();
    });

    it("keeps an explicit blank content clear in the durable revision payload", async () => {
        const source = previewSourceSnapshot();
        source.sessions[0] = { ...source.sessions[0]!, notes: "기존 메모" };
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: { sessions: [{ sessionIndex: 1, notes: "" }] },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });
        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source }) as {
            sessions: Array<Record<string, unknown>>;
            revision: { payload: Record<string, unknown> } | null;
        };
        expect(plan.sessions).toEqual([expect.objectContaining({ sourceRowId: "day-1", notes: "" })]);
        expect(plan.revision?.payload).toEqual(expect.objectContaining({
            sessions: expect.arrayContaining([
                expect.objectContaining({ sourceRowId: "day-1", notes: "" }),
            ]),
        }));
    });

    it("fails closed when future content lacks canonical employee ownership", async () => {
        const source = previewSourceSnapshot();
        source.assignments = [{
            ...source.assignments[0]!,
            employeeName: null,
            primaryEmployeeName: null,
        }];
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: { sessions: [{ sessionIndex: 2, notes: "관리자 미래 메모" }] },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });
        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        expect(() => input.prepare({ draft: activeDraft, source })).toThrow(ConflictException);
        expect(() => input.prepare({ draft: activeDraft, source })).toThrow(
            expect.objectContaining({ response: expect.objectContaining({
                code: "REQUEST_CONFLICT",
                outcome: "NOT_APPLIED",
            }) }),
        );
    });

    it("binds signature and document metadata into the preview identifier", async () => {
        const source = previewSourceSnapshot();
        source.signatureMetadata = {
            treatment: "preserve_existing",
            evidence: "observed",
            sessions: [{
                sessionIndex: 1,
                hasSignature: true,
                signedAt: "2026-09-01T03:00:00.000Z",
                submittedAt: "2026-09-01T04:00:00.000Z",
            }],
        };
        source.documentScope = {
            evidence: "observed",
            serviceRecordSnapshot: {
                documentIds: ["snapshot-doc-1"],
                snapshotVersion: 3,
                chunks: [{ documentId: "snapshot-doc-1", snapshotVersion: 3, snapshotChunkIndex: 0 }],
            },
            currentRevision: { id: "revision-1", revisionNumber: 2, formVersion: 3 },
            form: { version: 3 },
            contract: { currentDocumentId: "contract-doc-1", stage: "in_progress" },
        };
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        expect(harness.repository.createOrResumeDraft).toHaveBeenCalledWith(expect.objectContaining({
            sourceSnapshot: expect.objectContaining({
                signatureMetadata: source.signatureMetadata,
                documentScope: source.documentScope,
            }),
        }));
        const activeDraft = { ...started.draft, changes: {} };
        const atomicRepository = harness.repository as typeof harness.repository & { loadDraftWithSource: jest.Mock };
        atomicRepository.loadDraftWithSource = jest.fn().mockResolvedValue({ draft: activeDraft, source });

        const result = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });

        expect(result.signatureMetadata).toEqual(source.signatureMetadata);
        expect(result.documentScope).toEqual(source.documentScope);
        expect(result.previewId).toMatch(/^srp_[a-f0-9]{64}$/);
        const changed = { ...source, documentScope: {
            ...source.documentScope,
            contract: { currentDocumentId: "contract-doc-2", stage: "completed" as const },
        } };
        const changedHarness = createHarness({ source: changed });
        const changedStarted = await changedHarness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!changedStarted.draft) throw new Error("expected a changed draft");
        const changedDraft = { ...changedStarted.draft, changes: {} };
        const changedAtomicRepository = changedHarness.repository as typeof changedHarness.repository & { loadDraftWithSource: jest.Mock };
        changedAtomicRepository.loadDraftWithSource = jest.fn().mockResolvedValue({ draft: changedDraft, source: changed });
        const changedPreview = await changedHarness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: changedDraft.draftVersion,
        });
        expect(changedPreview.previewId).not.toBe(result.previewId);
    });

    it("binds a preview to the current source fingerprint and rejects stale drafts", async () => {
        const changedSource = previewSourceSnapshot();
        const harness = createHarness({
            source: changedSource,
            targetDraft: draft({ sourceFingerprint: "old-source" }),
        });

        await expect(harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
        })).rejects.toMatchObject({
            response: expect.objectContaining({
                code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
                sourceChanged: true,
            }),
        });

        const stale = createHarness({
            source: changedSource,
            targetDraft: draft({ draftVersion: 1 }),
        });
        stale.repository.findDraft.mockResolvedValue(draft({ draftVersion: 2 }));
        await expect(stale.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 2,
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" }),
        });
    });

    it("uses the latest lifecycle-only case version without rebasing a matching draft", async () => {
        const original = previewSourceSnapshot();
        const harness = createHarness({ source: original });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        harness.repository.findDraftById.mockResolvedValue(started.draft);
        harness.repository.loadSource.mockResolvedValue({ ...original, caseVersion: original.caseVersion + 1 });

        const result = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: started.draft.draftVersion,
        });

        expect(result.sourceCaseVersion).toBe(original.caseVersion + 1);
        expect(result.blockingReasons).toEqual([]);
    });

    it("captures complete signed provenance and marks incomplete sources partial", async () => {
        const source = completeSourceSnapshot();
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = { ...started.draft, changes: { header: { momName: "수정 산모" } } };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        const response = {
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        };
        harness.repository.confirmDraft.mockResolvedValue(response);
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });
        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source });
        if (!plan || typeof plan !== "object") throw new Error("expected confirmation plan");
        const typedPlan = plan as {
            documentJob: { payload: Record<string, unknown> } | null;
            revision: { payload: Record<string, unknown> } | null;
            documentStatus: string;
        };
        expect(typedPlan.documentStatus).toBe("capability_unverified");
        expect(typedPlan.documentJob?.payload["completeness"]).toBe("complete");
        expect(typedPlan.revision?.payload).toEqual(expect.objectContaining({
            completeness: "complete",
            caseLifecycle: expect.objectContaining({ status: "READY_TO_FINALIZE" }),
            sessions: expect.arrayContaining([
                expect.objectContaining({
                    clientSignature: "data:image/png;base64,aGVsbG8=",
                    employeeNameSnapshot: "제공자",
                    momApproval: "approved",
                    locked: true,
                    submittedAt: "2026-09-01T04:00:00.000Z",
                }),
            ]),
        }));

        const incompleteSource = {
            ...source,
            sessions: source.sessions.slice(0, 2),
        };
        const incompleteHarness = createHarness({ source: incompleteSource });
        const incompleteStarted = await incompleteHarness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!incompleteStarted.draft) throw new Error("expected an incomplete draft");
        const incompleteDraft = { ...incompleteStarted.draft, changes: { header: { momName: "수정 산모" } } };
        incompleteHarness.repository.findDraftById.mockResolvedValue(incompleteDraft);
        incompleteHarness.repository.loadSource.mockResolvedValue(incompleteSource);
        const incompletePreview = await incompleteHarness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: incompleteDraft.draftVersion,
        });
        incompleteHarness.repository.confirmDraft.mockResolvedValue(response);
        await incompleteHarness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: incompleteDraft.draftVersion,
            previewId: incompletePreview.previewId,
            idempotencyKey: "22222222-2222-4222-8222-222222222222",
        });
        const incompleteInput = incompleteHarness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof incompleteDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const incompletePlan = incompleteInput.prepare({ draft: incompleteDraft, source: incompleteSource }) as {
            documentJob: { payload: Record<string, unknown> } | null;
            documentStatus: string;
        };
        expect(incompletePlan.documentStatus).toBe("waiting_for_completion");
        expect(incompletePlan.documentJob?.payload["completeness"]).toBe("partial");
    });

    it("marks a complete source partial when the effective edited header is incomplete", async () => {
        const source = completeSourceSnapshot();
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: { header: { momName: "" } },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "77777777-7777-4777-8777-777777777777",
        });

        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source }) as {
            header: Record<string, unknown>;
            documentStatus: string;
            documentJob: { payload: Record<string, unknown> } | null;
            revision: { payload: Record<string, unknown> } | null;
        };
        expect(plan.header["momName"]).toBe("");
        expect(plan.documentStatus).toBe("waiting_for_completion");
        expect(plan.documentJob?.payload["completeness"]).toBe("partial");
        expect(plan.revision?.payload["completeness"]).toBe("partial");
    });

    it("keeps valid ISO header birthdays through preview and the confirmation plan", async () => {
        const source = completeSourceSnapshot();
        source.header = {
            ...source.header,
            momBirth: "1990-01-01", // already ISO (earlier ISO save)
            babyBirth: "260615", // untouched historic six-digit value
        };
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: { header: { babyBirth: "2026-07-14" } },
        });
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = started.draft;
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "77777777-7777-4777-8777-777777777777",
        });

        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source }) as {
            header: Record<string, unknown>;
            revision: { payload: Record<string, unknown> } | null;
        };
        // The saved record's header carries the exact ISO values — no rewrite
        // of the edited field and no conversion of the historic six-digit one.
        expect(plan.header["momBirth"]).toBe("1990-01-01");
        expect(plan.header["babyBirth"]).toBe("2026-07-14");
    });

    it("forwards the server preview and idempotency contract to the repository", async () => {
        const harness = createHarness();
        const response = {
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        };
        harness.repository.confirmDraft.mockResolvedValue(response);

        await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            previewId: `srp_${"a".repeat(64)}`,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        })).resolves.toEqual(response);

        expect(harness.repository.confirmDraft).toHaveBeenCalledWith(expect.objectContaining({
            branchId: BRANCH_ID,
            draftId: DRAFT_ID,
            expectedDraftVersion: 1,
            previewId: `srp_${"a".repeat(64)}`,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
            actorUserId: ACTOR_ID,
            requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
            prepare: expect.any(Function),
        }));
    });

    it("rejects a forged confirmation identifier before opening the repository boundary", async () => {
        const harness = createHarness();

        await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            previewId: "preview-from-client",
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(harness.repository.confirmDraft).not.toHaveBeenCalled();
    });

    describe("confirm guard reason and case-changed event", () => {
        const confirmDto = {
            expectedDraftVersion: 1,
            previewId: `srp_${"a".repeat(64)}`,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        };
        const confirmed = {
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 9,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 2,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        };

        it("names the blocking operation in the 409 body without changing the problem code", async () => {
            const harness = createHarness();
            harness.repository.confirmDraft.mockRejectedValue(new ServiceRecordRevisionOperationUnresolvedError(
                "A revision document operation is unresolved",
                "contract_period",
                "processing",
                null,
            ));

            const error = await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto)
                .catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as ConflictException).getStatus()).toBe(409);
            expect((error as ConflictException).getResponse()).toMatchObject({
                code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
                blockingOperation: { operation: "contract_period", status: "processing", lastErrorCode: null },
            });
        });

        it("keeps a plain repository conflict free of blockingOperation", async () => {
            const harness = createHarness();
            harness.repository.confirmDraft.mockRejectedValue(new ServiceRecordEditConflictError());

            const error = await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto)
                .catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ConflictException);
            const body = (error as ConflictException).getResponse() as Record<string, unknown>;
            expect(body["code"]).toBe("SERVICE_RECORD_WRITE_TARGET_CHANGED");
            expect(body).not.toHaveProperty("blockingOperation");
        });

        it("emits the new case version once after a successful confirm", async () => {
            const caseEventBus = { emit: jest.fn() };
            const harness = createHarness({ caseEventBus });
            harness.repository.confirmDraft.mockResolvedValue(confirmed);

            await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto))
                .resolves.toEqual(confirmed);

            expect(caseEventBus.emit).toHaveBeenCalledTimes(1);
            expect(caseEventBus.emit).toHaveBeenCalledWith({
                branchId: BRANCH_ID,
                clientId: CLIENT_ID,
                caseId: CASE_ID,
                caseVersion: 9,
            });
        });

        it("does not emit when the confirm is refused", async () => {
            const caseEventBus = { emit: jest.fn() };
            const harness = createHarness({ caseEventBus });
            harness.repository.confirmDraft.mockRejectedValue(new ServiceRecordEditConflictError());

            await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto))
                .rejects.toBeInstanceOf(ConflictException);
            expect(caseEventBus.emit).not.toHaveBeenCalled();
        });

        it("never fails the confirm when the event bus throws", async () => {
            const caseEventBus = { emit: jest.fn().mockImplementation(() => { throw new Error("bus down"); }) };
            const harness = createHarness({ caseEventBus });
            harness.repository.confirmDraft.mockResolvedValue(confirmed);

            await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto))
                .resolves.toEqual(confirmed);
            expect(caseEventBus.emit).toHaveBeenCalledTimes(1);
        });

        it("still confirms when no event bus is provided", async () => {
            const harness = createHarness();
            harness.repository.confirmDraft.mockResolvedValue(confirmed);

            await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto))
                .resolves.toEqual(confirmed);
        });
    });

    describe("registered problem contract bodies", () => {
        const expectProblemBody = async (
            rejection: Promise<unknown>,
            status: number,
            code: string,
            extra: Record<string, unknown> = {},
        ) => {
            await expect(rejection).rejects.toMatchObject({
                status,
                response: expect.objectContaining({
                    code,
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                    ...extra,
                }),
            });
        };

        it("keeps the 404 contract with a registered code for a forged confirm identifier", async () => {
            const harness = createHarness();

            await expectProblemBody(
                harness.service.confirmDraft(BRANCH_ID, "not-a-uuid", ACTOR_ID, {
                    expectedDraftVersion: 1,
                    previewId: `srp_${"a".repeat(64)}`,
                    idempotencyKey: "11111111-1111-4111-8111-111111111111",
                }),
                404,
                "RESOURCE_NOT_FOUND",
            );
            expect(harness.repository.confirmDraft).not.toHaveBeenCalled();
        });

        it("binds the confirm version guard to a validation problem body", async () => {
            const harness = createHarness();

            await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: 0,
                previewId: `srp_${"a".repeat(64)}`,
                idempotencyKey: "11111111-1111-4111-8111-111111111111",
            })).rejects.toMatchObject({
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    errors: [expect.objectContaining({
                        pointer: "/expectedDraftVersion",
                        code: "INVALID_FORMAT",
                    })],
                }),
            });
        });

        it("binds the preview id guard to a validation problem body", async () => {
            const harness = createHarness();

            await expect(harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: 1,
                previewId: "srp_forged",
                idempotencyKey: "11111111-1111-4111-8111-111111111111",
            })).rejects.toMatchObject({
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    errors: [expect.objectContaining({
                        pointer: "/previewId",
                        code: "INVALID_FORMAT",
                    })],
                }),
            });
        });

        it("maps a closed draft to the registered request-not-pending code", async () => {
            const harness = createHarness({
                targetDraft: draft({ status: "CONFIRMED" }),
            });

            await expectProblemBody(
                harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, { expectedDraftVersion: 1 }),
                409,
                "REQUEST_NOT_PENDING",
            );
        });

        it("maps a stale preview confirmation to the registered request-stale code", async () => {
            const source = previewSourceSnapshot();
            const harness = createHarness({ source });
            const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
            if (!started.draft) throw new Error("expected a draft");
            const activeDraft = { ...started.draft, changes: {} };
            harness.repository.confirmDraft.mockResolvedValue({ status: "confirmed" });

            await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: activeDraft.draftVersion,
                previewId: `srp_${"b".repeat(64)}`,
                idempotencyKey: "11111111-1111-4111-8111-111111111111",
            });
            const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
                prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
            };

            await expectProblemBody(
                Promise.resolve().then(() => input.prepare({ draft: activeDraft, source })),
                409,
                "REQUEST_STALE",
            );
        });

        it("maps a blocked preview confirmation to a registered conflict body", async () => {
            const source = previewSourceSnapshot();
            source.requiredSessionCount = null;
            const harness = createHarness({ source });
            const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
            if (!started.draft) throw new Error("expected a draft");
            const activeDraft = { ...started.draft, changes: {} };
            harness.repository.findDraftById.mockResolvedValue(activeDraft);
            harness.repository.confirmDraft.mockResolvedValue({ status: "confirmed" });
            const stalePreview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: activeDraft.draftVersion,
            });

            await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: activeDraft.draftVersion,
                previewId: stalePreview.previewId,
                idempotencyKey: "11111111-1111-4111-8111-111111111111",
            });
            const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
                prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
            };

            await expectProblemBody(
                Promise.resolve().then(() => input.prepare({ draft: activeDraft, source })),
                409,
                "REQUEST_CONFLICT",
            );
        });

        it("binds the draft-changes-required guard to a validation problem body", async () => {
            const harness = createHarness({ targetDraft: draft() });

            await expect(harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: 1,
                changes: undefined,
            } as unknown as Parameters<typeof harness.service.updateDraft>[3])).rejects.toMatchObject({
                response: expect.objectContaining({
                    code: "VALIDATION_FAILED",
                    errors: [expect.objectContaining({
                        pointer: "/changes",
                        code: "REQUIRED",
                    })],
                }),
            });
        });

        it("returns a registered not-found body when the draft or source is missing", async () => {
            const harness = createHarness({ targetDraft: null });
            harness.repository.findDraftById.mockResolvedValue(null);

            await expectProblemBody(
                harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                    expectedDraftVersion: 1,
                    changes: { header: { momName: "수정" } },
                }),
                404,
                "RESOURCE_NOT_FOUND",
            );
        });
    });

    describe("branch calendar", () => {
        // 2026-09-04 is a Friday that only this branch closes.
        const branchCalendar = (date: string, version: string) => createKrBusinessDayCalendar(
            [...KOREAN_HOLIDAY_CALENDAR[2026]!, date],
            { version, supportedYears: [2026] },
        );

        async function previewWith(calendar?: KrBusinessDayCalendar) {
            const source = previewSourceSnapshot();
            const harness = createHarness({ source, calendar });
            const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
            if (!started.draft) throw new Error("expected a draft");
            const activeDraft = { ...started.draft, changes: {} };
            (harness.repository as typeof harness.repository & { loadDraftWithSource: jest.Mock }).loadDraftWithSource =
                jest.fn().mockResolvedValue({ draft: activeDraft, source });
            const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: activeDraft.draftVersion,
            });
            return { harness, source, activeDraft, preview };
        }

        it("normalizes a date move with the fresh branch calendar before persisting the draft", async () => {
            const harness = createHarness({
                source: previewSourceSnapshot(),
                calendar: branchCalendar("2026-09-04", "kr-db-branch-a"),
            });
            await harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: 1,
                changes: { header: { momName: "수정" } },
                dateMove: { sessionIndex: 2, toDate: "2026-09-03" },
            });
            expect(harness.holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });
            const saved = harness.repository.updateDraft.mock.calls.at(-1)?.[0] as {
                changes: { sessions: Array<{ sessionIndex: number; serviceDate?: string }> };
            };
            // Built-in calendar would put session 3 on Friday 09-04; the branch closes it.
            expect(saved.changes.sessions.map(({ sessionIndex, serviceDate }) => [sessionIndex, serviceDate])).toEqual([
                [2, "2026-09-03"],
                [3, "2026-09-07"],
            ]);

            const builtin = createHarness({ source: previewSourceSnapshot() });
            await builtin.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
                expectedDraftVersion: 1,
                changes: { header: { momName: "수정" } },
                dateMove: { sessionIndex: 2, toDate: "2026-09-03" },
            });
            const builtinSaved = builtin.repository.updateDraft.mock.calls.at(-1)?.[0] as {
                changes: { sessions: Array<{ sessionIndex: number; serviceDate?: string }> };
            };
            expect(builtinSaved.changes.sessions.map(({ serviceDate }) => serviceDate)).toEqual(["2026-09-03", "2026-09-04"]);
        });

        it("previews with the fresh branch calendar without invalidating historical dates", async () => {
            const builtin = await previewWith();
            expect(builtin.preview.blockingReasons).toEqual([]);
            expect(builtin.harness.holidayCalendar.forBranch).toHaveBeenCalledWith(BRANCH_ID, { fresh: true });

            // 2026-09-02 is inside the planned vector (09-01..09-03).
            const branch = await previewWith(branchCalendar("2026-09-02", "kr-db-branch-b"));
            expect(branch.preview.calendarVersion).toBe("kr-db-branch-b");
            expect(branch.preview.blockingReasons).toEqual([]);
            expect(branch.preview.before.sessions).toEqual(builtin.preview.before.sessions);
            expect(branch.preview.previewId).not.toBe(builtin.preview.previewId);
        });

        it("confirms with the preview's calendar and answers REQUEST_STALE once the calendar changed", async () => {
            const calendarA = branchCalendar("2026-09-04", "kr-db-branch-a");
            const { harness, source, activeDraft, preview } = await previewWith(calendarA);
            expect(preview.calendarVersion).toBe("kr-db-branch-a");
            harness.repository.confirmDraft.mockResolvedValue({ status: "confirmed" });
            const confirmDto = {
                expectedDraftVersion: activeDraft.draftVersion,
                previewId: preview.previewId,
                idempotencyKey: "11111111-1111-4111-8111-111111111111",
            };

            await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto);
            expect(harness.holidayCalendar.forBranch).toHaveBeenLastCalledWith(BRANCH_ID, { fresh: true });
            const sameCalendar = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
                prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
            };
            expect(() => sameCalendar.prepare({ draft: activeDraft, source })).not.toThrow();

            (harness.holidayCalendar.forBranch as jest.Mock).mockImplementation(
                async () => branchCalendar("2026-09-04", "kr-db-branch-c"),
            );
            await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, confirmDto);
            const changedCalendar = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
                prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
            };
            expect(() => changedCalendar.prepare({ draft: activeDraft, source })).toThrow(
                expect.objectContaining({ response: expect.objectContaining({ code: "REQUEST_STALE" }) }),
            );
        });
    });
});

describe("AdminServiceRecordEditService receipt facts follow the current contract", () => {
    const POINTER_DOCUMENT_ID = "contract-document-1";
    const CURRENT_DOCUMENT_ID = "contract-document-2";
    const TOKEN_ID = "66666666-6666-4666-8666-666666666666";

    function pinnedFactsSource(): ServiceRecordEditRevisionFactsSource {
        return observedRevisionFactsSource();
    }

    /** The same observed contract, re-issued as the client's newer current document. */
    function currentFactsDocument(): NonNullable<ServiceRecordEditRevisionFactsSource["document"]> {
        const pinned = pinnedFactsSource().document!;
        const detail = pinned.detailPayload as Record<string, unknown>;
        return {
            ...pinned,
            documentId: CURRENT_DOCUMENT_ID,
            mirrorGeneration: "mirror-generation-9",
            detailPayload: { ...detail, id: CURRENT_DOCUMENT_ID },
        };
    }

    function liveToken() {
        return {
            id: TOKEN_ID,
            eformsignDocId: 77,
            branchId: BRANCH_ID,
            clientId: CLIENT_ID,
            active: true,
            revokedAt: null,
        };
    }

    async function planWith(revisionFactsSource: ServiceRecordEditRevisionFactsSource) {
        const source = previewSourceSnapshot();
        source.documentScope = {
            evidence: "observed",
            serviceRecordSnapshot: { documentIds: [], snapshotVersion: null, chunks: [] },
            currentRevision: { id: null, revisionNumber: null, formVersion: null },
            form: { version: source.formVersion },
            // client.eDocId still points at the OLD document...
            contract: { currentDocumentId: POINTER_DOCUMENT_ID, stage: "in_progress" },
            // ...while the receipt token was issued for the newer current contract.
            receipt: {
                evidence: "observed",
                eformsignDocId: 77,
                tokenIds: [TOKEN_ID],
                sourceDocumentId: CURRENT_DOCUMENT_ID,
            },
        };
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = {
            ...started.draft,
            changes: { sessions: [{ sessionIndex: 3, serviceDate: "2026-09-04" }] },
        };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-09-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });
        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            serviceRecordTemplateIds?: string[];
            prepare: (snapshot: {
                draft: typeof activeDraft;
                source: ServiceRecordEditSource;
                revisionFactsSource?: ServiceRecordEditRevisionFactsSource;
            }) => unknown;
        };
        const plan = input.prepare({ draft: activeDraft, source, revisionFactsSource }) as {
            contractOperation: {
                status: string;
                sourceDocumentId: string | null;
                immutableInput: Record<string, unknown>;
            } | null;
            receiptOperation: {
                status: string;
                sourceDocumentId: string | null;
                lastErrorCode: string | null;
                immutableInput: Record<string, unknown>;
            } | null;
        };
        return { plan, input };
    }

    it("rebuilds the receipt from the current contract while the eDocId pointer lags", async () => {
        const { plan } = await planWith({
            document: pinnedFactsSource().document,
            receiptTokens: [liveToken()],
            receiptDocument: currentFactsDocument(),
        });

        expect(plan.receiptOperation?.status).toBe("pending");
        expect(plan.receiptOperation?.sourceDocumentId).toBe(CURRENT_DOCUMENT_ID);
        expect(plan.receiptOperation?.immutableInput).toEqual(expect.objectContaining({
            kind: "receipt_refresh",
            tokens: { eformsignDocId: 77, tokenIds: [TOKEN_ID] },
            source: expect.objectContaining({
                documentId: CURRENT_DOCUMENT_ID,
                mirrorGeneration: "mirror-generation-9",
            }),
        }));
    });

    it("leaves contract-revision targeting on the eDocId-pinned document", async () => {
        const { plan } = await planWith({
            document: pinnedFactsSource().document,
            receiptTokens: [liveToken()],
            receiptDocument: currentFactsDocument(),
        });

        expect(plan.contractOperation?.status).toBe("pending");
        expect(plan.contractOperation?.sourceDocumentId).toBe(POINTER_DOCUMENT_ID);
        expect(plan.contractOperation?.immutableInput).toEqual(expect.objectContaining({
            kind: "contract_period",
            original: expect.objectContaining({
                documentId: POINTER_DOCUMENT_ID,
                mirrorGeneration: "mirror-generation-7",
            }),
        }));
        // Neither the facts the contract write is built from nor its pinned workflow carry the
        // receipt's document (the embedded revision payload legitimately records the scope).
        expect(JSON.stringify(plan.contractOperation?.immutableInput?.["original"])).not.toContain(CURRENT_DOCUMENT_ID);
        expect(JSON.stringify(plan.contractOperation?.immutableInput?.["target"])).not.toContain(CURRENT_DOCUMENT_ID);
    });

    it("fails the receipt closed, not onto the pointer's document, when the current contract is unresolved", async () => {
        const { plan } = await planWith({
            document: pinnedFactsSource().document,
            receiptTokens: [liveToken()],
            receiptDocument: null,
        });

        expect(plan.receiptOperation?.status).toBe("manual_review");
        expect(plan.receiptOperation?.lastErrorCode).toBe("SERVICE_RECORD_RECEIPT_FACTS_UNAVAILABLE");
        expect(plan.receiptOperation?.sourceDocumentId).not.toBe(POINTER_DOCUMENT_ID);
        // The contract operation is not affected by the receipt failing closed.
        expect(plan.contractOperation?.status).toBe("pending");
        expect(plan.contractOperation?.sourceDocumentId).toBe(POINTER_DOCUMENT_ID);
    });

    it("keeps the previous behaviour when the receipt document is the pointer's document", async () => {
        const pinned = pinnedFactsSource().document!;
        const sameDocument = await planWith({
            document: pinned,
            receiptTokens: [liveToken()],
            receiptDocument: pinned,
        });
        const omitted = await planWith({
            document: pinned,
            receiptTokens: [liveToken()],
        });

        for (const { plan } of [sameDocument, omitted]) {
            expect(plan.receiptOperation?.status).toBe("pending");
            expect(plan.receiptOperation?.immutableInput).toEqual(expect.objectContaining({
                source: expect.objectContaining({ documentId: POINTER_DOCUMENT_ID }),
            }));
        }
        expect(sameDocument.plan.receiptOperation?.immutableInput)
            .toEqual(omitted.plan.receiptOperation?.immutableInput);
    });

    it("hands the configured service-record template ids to the repository for the current-contract rule", async () => {
        const { input } = await planWith({
            document: pinnedFactsSource().document,
            receiptTokens: [liveToken()],
            receiptDocument: currentFactsDocument(),
        });

        expect(Array.isArray(input.serviceRecordTemplateIds)).toBe(true);
    });
});

describe("AdminServiceRecordEditService confirm assignment dates", () => {
    const base = previewSourceSnapshot();
    const caregiverA = {
        ...base.assignments[0]!,
        id: "aaaaaaaa-0000-4000-8000-00000000000a",
        scheduleId: 701,
        employeeId: 31,
        employeeName: "공혜순",
        primaryEmployeeId: 31,
        primaryEmployeeName: "공혜순",
        startDate: "2026-10-01",
        endDate: "2026-10-14",
        scheduleStartDate: "2026-10-01",
        scheduleEndDate: "2026-10-14",
        replaced: true,
    };
    const caregiverB = {
        ...caregiverA,
        id: "bbbbbbbb-0000-4000-8000-00000000000b",
        scheduleId: 702,
        employeeId: 32,
        employeeName: "임선녀",
        primaryEmployeeId: 32,
        primaryEmployeeName: "임선녀",
        startDate: "2026-10-14",
        endDate: "2026-10-23",
        scheduleStartDate: "2026-10-14",
        scheduleEndDate: "2026-10-23",
        replaced: false,
    };
    const dates = [
        "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08",
        "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16",
        "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
    ];

    function written(sessionIndex: number, owner: typeof caregiverA) {
        return {
            ...base.sessions[0]!,
            id: `day-${sessionIndex}`,
            sourceRowId: `day-${sessionIndex}`,
            sessionIndex,
            rawCaseSessionIndex: sessionIndex,
            rawSessionIndex: sessionIndex,
            serviceDate: dates[sessionIndex - 1]!,
            scheduleId: owner.scheduleId,
            employeeId: owner.employeeId,
            employeeNameSnapshot: owner.employeeName,
        };
    }

    /** The stored vector gives sessions 1-7 to A and 8-15 to B, as an earlier confirmed edit left it. */
    function handoverSource(rows: ReturnType<typeof written>[]): ServiceRecordEditSource {
        return {
            ...base,
            requiredSessionCount: dates.length,
            startDate: dates[0]!,
            endDate: dates.at(-1)!,
            client: { ...base.client, startDate: dates[0]!, endDate: dates.at(-1)! },
            sessions: rows,
            assignments: [caregiverA, caregiverB],
            plannedSessions: dates.map((serviceDate, index) => {
                const owner = index < 7 ? caregiverA : caregiverB;
                return {
                    sessionIndex: index + 1,
                    serviceDate,
                    originalDate: serviceDate,
                    assignmentId: owner.id,
                    scheduleId: owner.scheduleId,
                    employeeId: owner.employeeId,
                    provenanceVersion: "case-7",
                };
            }),
        };
    }

    async function confirmedAssignments(
        source: ServiceRecordEditSource,
        changes: Record<string, unknown>,
    ) {
        const harness = createHarness({ source });
        const started = await harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
        if (!started.draft) throw new Error("expected a draft");
        const activeDraft = { ...started.draft, changes };
        harness.repository.findDraftById.mockResolvedValue(activeDraft);
        harness.repository.loadSource.mockResolvedValue(source);
        const preview = await harness.service.previewDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
        });
        expect(preview.blockingReasons).toEqual([]);
        harness.repository.confirmDraft.mockResolvedValue({
            status: "confirmed" as const,
            caseId: CASE_ID,
            clientId: CLIENT_ID,
            draftId: DRAFT_ID,
            draftVersion: 2,
            caseVersion: 8,
            revisionId: "55555555-5555-4555-8555-555555555555",
            revisionNumber: 1,
            documentStatus: "capability_unverified" as const,
            confirmedAt: "2026-10-08T01:02:03.000Z",
        });
        await harness.service.confirmDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: activeDraft.draftVersion,
            previewId: preview.previewId,
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        });
        const input = harness.repository.confirmDraft.mock.calls.at(-1)?.[0] as {
            prepare: (snapshot: { draft: typeof activeDraft; source: ServiceRecordEditSource }) => unknown;
        };
        return input.prepare({ draft: activeDraft, source }) as {
            assignments: Array<{
                assignmentId: string | null;
                scheduleId: number | null;
                startDate: string;
                endDate: string;
                datesChanged?: boolean;
            }>;
            revision: { provenance: Array<{ assignmentId: string; startDate: string; endDate: string }> } | null;
        };
    }

    const headerOnly = { header: { momName: "수정 산모" } };

    it("keeps the stored handover boundary on a header-only confirm", async () => {
        const plan = await confirmedAssignments(
            handoverSource([written(1, caregiverA), written(8, caregiverB)]),
            headerOnly,
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, scheduleId: 701, startDate: "2026-10-01", endDate: "2026-10-14" }),
            expect.objectContaining({ assignmentId: caregiverB.id, scheduleId: 702, startDate: "2026-10-14", endDate: "2026-10-23" }),
        ]);
        // The revision still records the owned session ranges.
        expect(plan.revision?.provenance).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-13" }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23" }),
        ]);
    });

    it("keeps both stored boundaries after the new caregiver backfilled earlier sessions", async () => {
        const rows = [written(1, caregiverA), ...[2, 3, 4, 5, 6, 7].map((index) => written(index, caregiverB))];
        const plan = await confirmedAssignments(handoverSource(rows), headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14" }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23" }),
        ]);
        expect(plan.revision?.provenance).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-01" }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-02", endDate: "2026-10-23" }),
        ]);
    });

    it("keeps every stored date for three caregivers after a partial backfill", async () => {
        // Vector A 1-7 / B 8-10 / C 11-15. A wrote 1 and C backfilled 2, so B owns no session at all.
        const caregiverC = {
            ...caregiverB,
            id: "cccccccc-0000-4000-8000-00000000000c",
            scheduleId: 703,
            employeeId: 33,
            employeeName: "후임",
            primaryEmployeeId: 33,
            primaryEmployeeName: "후임",
            startDate: "2026-10-19",
            scheduleStartDate: "2026-10-19",
            endDate: "2026-10-23",
            scheduleEndDate: "2026-10-23",
            replaced: false,
        };
        const middle = {
            ...caregiverB,
            replaced: true,
            endDate: "2026-10-19",
            scheduleEndDate: "2026-10-19",
        };
        const source: ServiceRecordEditSource = {
            ...handoverSource([written(1, caregiverA), written(2, caregiverC)]),
            assignments: [caregiverA, middle, caregiverC],
            plannedSessions: dates.map((serviceDate, index) => {
                const owner = index < 7 ? caregiverA : index < 10 ? middle : caregiverC;
                return {
                    sessionIndex: index + 1,
                    serviceDate,
                    originalDate: serviceDate,
                    assignmentId: owner.id,
                    scheduleId: owner.scheduleId,
                    employeeId: owner.employeeId,
                    provenanceVersion: "case-7",
                };
            }),
        };
        const plan = await confirmedAssignments(source, headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14" }),
            expect.objectContaining({ assignmentId: middle.id, startDate: "2026-10-14", endDate: "2026-10-19" }),
            expect.objectContaining({ assignmentId: caregiverC.id, startDate: "2026-10-19", endDate: "2026-10-23" }),
        ]);
    });

    it("moves only the case's last edge, never the handover, when sessions move later", async () => {
        // Every session from 7 on moves two business days later, so A now owns a session (10-15) after
        // the stored handover day (10-14). The handover is the caregiver replacement flow's to change, so it
        // stays; only the latest assignment's end follows the new last session.
        const moved = ["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"];
        const plan = await confirmedAssignments(
            handoverSource([written(1, caregiverA), written(8, caregiverB)]),
            { sessions: moved.map((serviceDate, offset) => ({ sessionIndex: offset + 7, serviceDate })) },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14" }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-27" }),
        ]);
    });

    it("reports a conflict instead of writing an assignment whose end precedes its start", async () => {
        // Stored A end = B start = 10-22 (after a pause). Sessions 8-9 are moved back to 10-14 and 10-15,
        // so the case would end before B's stored start.
        const afterPause = ["2026-10-22", "2026-10-23"];
        const source: ServiceRecordEditSource = {
            ...handoverSource([written(1, caregiverA)]),
            requiredSessionCount: 9,
            endDate: "2026-10-23",
            assignments: [
                { ...caregiverA, endDate: "2026-10-22", scheduleEndDate: "2026-10-22" },
                { ...caregiverB, startDate: "2026-10-22", scheduleStartDate: "2026-10-22" },
            ],
            plannedSessions: [...dates.slice(0, 7), ...afterPause].map((serviceDate, index) => {
                const owner = index < 7 ? caregiverA : caregiverB;
                return {
                    sessionIndex: index + 1,
                    serviceDate,
                    originalDate: serviceDate,
                    assignmentId: owner.id,
                    scheduleId: owner.scheduleId,
                    employeeId: owner.employeeId,
                    provenanceVersion: "case-7",
                };
            }),
        };
        await expect(confirmedAssignments(source, {
            sessions: [
                { sessionIndex: 8, serviceDate: "2026-10-14" },
                { sessionIndex: 9, serviceDate: "2026-10-15" },
            ],
        })).rejects.toBeInstanceOf(ServiceRecordEditConflictError);
    });

    /** A terminated schedule on the case: dates only, never an outer edge (even when it owns no session). */
    const terminated = {
        ...caregiverB,
        scheduleTerminatedAt: "2026-09-06T00:00:00.000Z",
        id: "dddddddd-0000-4000-8000-00000000000d",
        scheduleId: 704,
        employeeId: 34,
        employeeName: "종료",
        primaryEmployeeId: 34,
        primaryEmployeeName: "종료",
        replaced: false,
    };
    function singleOwnerSource(
        single: typeof caregiverB,
        extra: typeof terminated,
        order: "extra-first" | "extra-last",
    ): ServiceRecordEditSource {
        return {
            ...handoverSource([written(1, single)]),
            assignments: order === "extra-first" ? [extra, single] : [single, extra],
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: single.id,
                scheduleId: single.scheduleId,
                employeeId: single.employeeId,
                provenanceVersion: "case-7",
            })),
        };
    }

    it("does not treat a session-less terminated schedule before the first session as the case start", async () => {
        const single = {
            ...caregiverB,
            startDate: "2026-09-28",
            scheduleStartDate: "2026-09-28",
            endDate: "2026-10-23",
            scheduleEndDate: "2026-10-23",
        };
        const early = {
            ...terminated,
            startDate: "2026-09-01",
            scheduleStartDate: "2026-09-01",
            endDate: "2026-09-05",
            scheduleEndDate: "2026-09-05",
        };
        const plan = await confirmedAssignments(singleOwnerSource(single, early, "extra-first"), headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: early.id, scheduleId: 704, startDate: "2026-09-01", endDate: "2026-09-05" }),
            expect.objectContaining({ assignmentId: single.id, scheduleId: 702, startDate: "2026-10-01", endDate: "2026-10-23" }),
        ]);
    });

    it("does not extend a session-less terminated schedule stored after the last session", async () => {
        const single = {
            ...caregiverB,
            startDate: "2026-10-01",
            scheduleStartDate: "2026-10-01",
            endDate: "2026-10-25",
            scheduleEndDate: "2026-10-25",
        };
        const late = {
            ...terminated,
            startDate: "2026-10-26",
            scheduleStartDate: "2026-10-26",
            endDate: "2026-10-30",
            scheduleEndDate: "2026-10-30",
        };
        const plan = await confirmedAssignments(singleOwnerSource(single, late, "extra-last"), headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: single.id, startDate: "2026-10-01", endDate: "2026-10-23" }),
            expect.objectContaining({ assignmentId: late.id, scheduleId: 704, startDate: "2026-10-26", endDate: "2026-10-30" }),
        ]);
    });

    it("keeps both stored ranges when only the later caregiver wrote sessions, backfilling the earlier ones", async () => {
        // B wrote sessions 1-8, so the provenance holds only B. B's first session (10-01) lies inside A's
        // stored period, so B's start must stay on the stored handover day, not move to 10-01.
        const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => written(index, caregiverB));
        const plan = await confirmedAssignments(handoverSource(rows), headerOnly);
        expect(plan.revision?.provenance).toEqual([
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-01", endDate: "2026-10-23" }),
        ]);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("ends the latest assignment on the last session even when the earlier caregiver owns every session", async () => {
        // Mirror of the header-only backfill case: every session is A's, and the last (10-23) lies inside B's
        // stored period. Ownership no longer decides the edges: B is the latest active assignment, so it
        // covers 10-23 and its end follows the last planned session, which is its stored end already.
        // A is the earliest and starts on the first session (its stored start). Both stay unchanged; the
        // old "keep B because A owns everything" reasoning is gone, only the result is the same.
        const source: ServiceRecordEditSource = {
            ...handoverSource(dates.map((_, index) => written(index + 1, caregiverA))),
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverA.id,
                scheduleId: caregiverA.scheduleId,
                employeeId: caregiverA.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("ends the latest assignment on a moved last session even when the earlier caregiver owns every session", async () => {
        // Same ownership, but the last session moves to 10-27: B (the latest active assignment) ends on 10-27
        // although it owns no session, since its period covers the day; A keeps its stored dates.
        const source: ServiceRecordEditSource = {
            ...handoverSource(dates.map((_, index) => written(index + 1, caregiverA))),
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverA.id,
                scheduleId: caregiverA.scheduleId,
                employeeId: caregiverA.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, { sessions: [{ sessionIndex: 15, serviceDate: "2026-10-27" }] });
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-27", datesChanged: true }),
        ]);
    });

    it("starts the replaced caregiver on the moved first session when she wrote nothing and the successor backfilled", async () => {
        // A (10-01..10-14, replaced) wrote nothing; B (10-14..10-23) owns every session. Session 1 moves to
        // 09-29. The case now starts on 09-29, and A's period must cover it: A, the earliest active
        // assignment, starts on 09-29. B and A's end stay (inner handover untouched).
        const source: ServiceRecordEditSource = {
            ...handoverSource(dates.map((_, index) => written(index + 1, caregiverB))),
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverB.id,
                scheduleId: caregiverB.scheduleId,
                employeeId: caregiverB.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, { sessions: [{ sessionIndex: 1, serviceDate: "2026-09-29" }] });
        expect(plan.revision?.provenance).toEqual([
            expect.objectContaining({ assignmentId: caregiverB.id }),
        ]);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-09-29", endDate: "2026-10-14", datesChanged: true }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("ends the successor on the moved last session when the replaced caregiver wrote nothing", async () => {
        const source: ServiceRecordEditSource = {
            ...handoverSource(dates.map((_, index) => written(index + 1, caregiverB))),
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverB.id,
                scheduleId: caregiverB.scheduleId,
                employeeId: caregiverB.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, { sessions: [{ sessionIndex: 15, serviceDate: "2026-10-27" }] });
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-27", datesChanged: true }),
        ]);
    });

    const shiftedAll = [
        "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21",
        "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28",
        "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04",
    ].map((serviceDate, offset) => ({ sessionIndex: offset + 1, serviceDate }));

    it("keeps an assignment that wrote nothing when every session moves past its stored end", async () => {
        // A (10-01..10-14) wrote nothing, B owns the sessions. All 15 sessions shift to start on 10-15, after
        // A's stored end. A owns no session, so it keeps its stored period instead of failing the confirm
        // (the replacement flow cannot edit a replaced schedule, so a throw would make the case uneditable);
        // the next assignment's start is an inner boundary and stays. B, the latest, ends on the last session.
        const source: ServiceRecordEditSource = {
            ...handoverSource(dates.map((_, index) => written(index + 1, caregiverB))),
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverB.id,
                scheduleId: caregiverB.scheduleId,
                employeeId: caregiverB.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, { sessions: shiftedAll });
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-11-04", datesChanged: true }),
        ]);
    });

    it("still reports a conflict when the earliest assignment owns sessions and they all move past its stored end", async () => {
        // A owns sessions 1-7 and B 8-15. Every session moves to 10-15 or later, so A, which owns sessions,
        // would start after its stored end 10-14: a real conflict for the replacement flow.
        const plan = confirmedAssignments(
            handoverSource([written(1, caregiverA), written(8, caregiverB)]),
            { sessions: shiftedAll },
        );
        await expect(plan).rejects.toBeInstanceOf(ServiceRecordEditConflictError);
    });

    it("keeps the latest assignment that wrote nothing when every session now ends before its stored start", async () => {
        // Mirror: A owns every session and the plan now ends 10-13, before B's stored start 10-14. B owns
        // nothing, so it keeps its stored period instead of failing the confirm; A is untouched.
        const source: ServiceRecordEditSource = {
            ...handoverSource([written(1, caregiverA)]),
            requiredSessionCount: 7,
            endDate: "2026-10-13",
            plannedSessions: dates.slice(0, 7).map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverA.id,
                scheduleId: caregiverA.scheduleId,
                employeeId: caregiverA.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("keeps a replaced zero-length period and its successor's start when every session shifts one slot later", async () => {
        // R was replaced before the contract start, so it is stored as [10-01,10-01]; B [10-01,10-23] owns
        // every session. The first session moves to 10-02: R (owns nothing) must not throw, nor move.
        const replacedEarly = {
            ...caregiverA,
            startDate: "2026-10-01",
            scheduleStartDate: "2026-10-01",
            endDate: "2026-10-01",
            scheduleEndDate: "2026-10-01",
        };
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const shifted = [...dates.slice(1), "2026-10-26"];
        const source: ServiceRecordEditSource = {
            ...handoverSource(dates.map((_, index) => written(index + 1, successor))),
            assignments: [replacedEarly, successor],
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: successor.id,
                scheduleId: successor.scheduleId,
                employeeId: successor.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, {
            sessions: shifted.map((serviceDate, offset) => ({ sessionIndex: offset + 1, serviceDate })),
        });
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: replacedEarly.id, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: false }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-26", datesChanged: true }),
        ]);
    });

    it("keeps the first active start when a terminated assignment stored before it ends after the first session", async () => {
        const single = {
            ...caregiverB,
            startDate: "2026-09-28",
            scheduleStartDate: "2026-09-28",
            endDate: "2026-10-23",
            scheduleEndDate: "2026-10-23",
        };
        const overlapping = {
            ...terminated,
            startDate: "2026-09-20",
            scheduleStartDate: "2026-09-20",
            endDate: "2026-10-05",
            scheduleEndDate: "2026-10-05",
        };
        const plan = await confirmedAssignments(singleOwnerSource(single, overlapping, "extra-first"), headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: overlapping.id, startDate: "2026-09-20", endDate: "2026-10-05", datesChanged: false }),
            expect.objectContaining({ assignmentId: single.id, startDate: "2026-09-28", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("keeps the last active end when a terminated assignment stored after it starts before the last session", async () => {
        const single = {
            ...caregiverB,
            startDate: "2026-10-01",
            scheduleStartDate: "2026-10-01",
            endDate: "2026-10-25",
            scheduleEndDate: "2026-10-25",
        };
        const overlapping = {
            ...terminated,
            startDate: "2026-10-20",
            scheduleStartDate: "2026-10-20",
            endDate: "2026-10-30",
            scheduleEndDate: "2026-10-30",
        };
        const plan = await confirmedAssignments(singleOwnerSource(single, overlapping, "extra-last"), headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: single.id, startDate: "2026-10-01", endDate: "2026-10-25", datesChanged: false }),
            expect.objectContaining({ assignmentId: overlapping.id, startDate: "2026-10-20", endDate: "2026-10-30", datesChanged: false }),
        ]);
    });

    it("keeps the contracted period of a single terminated caregiver, extending its end but never shrinking it", async () => {
        // A case ended early (중도 종료) has its only schedule terminated, and termination deliberately keeps
        // the contracted period in end_date (client.service.ts). The schedule owns the sessions, so it is
        // still an outer edge, but only to grow: stored 09-28..10-25. Header-only: the first session (10-01)
        // is later than the stored start and the last (10-23) earlier than the stored end, so nothing
        // shrinks. Last session moved to 10-26: the end extends, the start still stays.
        const single = {
            ...caregiverB,
            scheduleTerminatedAt: "2026-10-20T00:00:00.000Z",
            startDate: "2026-09-28",
            scheduleStartDate: "2026-09-28",
            endDate: "2026-10-25",
            scheduleEndDate: "2026-10-25",
        };
        const source = {
            ...handoverSource([written(1, single)]),
            assignments: [single],
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: single.id,
                scheduleId: single.scheduleId,
                employeeId: single.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const unchanged = await confirmedAssignments(source, headerOnly);
        expect(unchanged.assignments).toEqual([
            expect.objectContaining({ assignmentId: single.id, startDate: "2026-09-28", endDate: "2026-10-25", datesChanged: false }),
        ]);
        const later = await confirmedAssignments(source, { sessions: [{ sessionIndex: 15, serviceDate: "2026-10-26" }] });
        expect(later.assignments).toEqual([
            expect.objectContaining({ assignmentId: single.id, startDate: "2026-09-28", endDate: "2026-10-26", datesChanged: true }),
        ]);
    });

    it("moves a terminated caregiver's start earlier when the first session precedes it", async () => {
        const single = {
            ...caregiverB,
            scheduleTerminatedAt: "2026-10-20T00:00:00.000Z",
            startDate: "2026-10-03",
            scheduleStartDate: "2026-10-03",
            endDate: "2026-10-25",
            scheduleEndDate: "2026-10-25",
        };
        const source = {
            ...handoverSource([written(1, single)]),
            assignments: [single],
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: single.id,
                scheduleId: single.scheduleId,
                employeeId: single.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: single.id, startDate: "2026-10-01", endDate: "2026-10-25", datesChanged: true }),
        ]);
    });

    it("ends a terminated latest caregiver on the last session when she owns sessions", async () => {
        const terminatedB = { ...caregiverB, scheduleTerminatedAt: "2026-10-25T00:00:00.000Z" };
        const source: ServiceRecordEditSource = {
            ...handoverSource([written(1, caregiverA), written(8, terminatedB)]),
            assignments: [caregiverA, terminatedB],
        };
        const plan = await confirmedAssignments(source, { sessions: [{ sessionIndex: 15, serviceDate: "2026-10-27" }] });
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: terminatedB.id, startDate: "2026-10-14", endDate: "2026-10-27", datesChanged: true }),
        ]);
    });

    it("keeps the last active end when a session-less terminated assignment starts exactly on it", async () => {
        // A [10-01,10-14] owns sessions 1-7 (plan now ends 10-13); T [10-14,10-23] is terminated and owns
        // nothing. T abuts A's end, so A's end is a boundary shared with T and must not shrink to 10-13.
        const abutting = {
            ...terminated,
            startDate: "2026-10-14",
            scheduleStartDate: "2026-10-14",
            endDate: "2026-10-23",
            scheduleEndDate: "2026-10-23",
        };
        const source: ServiceRecordEditSource = {
            ...handoverSource([written(1, caregiverA)]),
            requiredSessionCount: 7,
            endDate: "2026-10-13",
            assignments: [caregiverA, abutting],
            plannedSessions: dates.slice(0, 7).map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverA.id,
                scheduleId: caregiverA.scheduleId,
                employeeId: caregiverA.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: abutting.id, startDate: "2026-10-14", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("keeps the first active start when a session-less terminated assignment ends exactly on it", async () => {
        // Mirror: T [09-25,10-01] is terminated and owns nothing; B [10-01,10-23] owns the sessions and the
        // plan now starts 10-02. T's end is shared with B's start, so B's start must not move to 10-02.
        const abutting = {
            ...terminated,
            startDate: "2026-09-25",
            scheduleStartDate: "2026-09-25",
            endDate: "2026-10-01",
            scheduleEndDate: "2026-10-01",
        };
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const source: ServiceRecordEditSource = {
            ...handoverSource([]),
            requiredSessionCount: 14,
            startDate: "2026-10-02",
            assignments: [abutting, successor],
            plannedSessions: dates.slice(1).map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: successor.id,
                scheduleId: successor.scheduleId,
                employeeId: successor.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: abutting.id, startDate: "2026-09-25", endDate: "2026-10-01", datesChanged: false }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    /** B owns every session; `others` are session-less neighbours stored around it. */
    function successorOwnsAllSource(
        successor: typeof caregiverB,
        others: Array<typeof terminated>,
        order: "others-first" | "others-last" = "others-first",
    ): ServiceRecordEditSource {
        return {
            ...handoverSource(dates.map((_, index) => written(index + 1, successor))),
            assignments: order === "others-first" ? [...others, successor] : [successor, ...others],
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: successor.id,
                scheduleId: successor.scheduleId,
                employeeId: successor.employeeId,
                provenanceVersion: "case-7",
            })),
        };
    }

    const placeholderOn = (date: string, suffix: string, scheduleId: number) => ({
        ...terminated,
        id: `eeeeeeee-0000-4000-8000-0000000000${suffix}`,
        scheduleId,
        startDate: date,
        scheduleStartDate: date,
        endDate: date,
        scheduleEndDate: date,
    });

    it("lets the successor start on an earlier first session and moves the same-day zero-length terminated placeholder with it", async () => {
        // T was replaced before the service started (stored [10-01,10-01], owns nothing); B [10-01,10-23]
        // owns every session. The first session moves to 09-29: B's start follows it, and T moves to
        // [09-29,09-29] so T's end still equals B's start.
        const placeholder = placeholderOn("2026-10-01", "01", 704);
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const plan = await confirmedAssignments(
            successorOwnsAllSource(successor, [placeholder]),
            { sessions: [{ sessionIndex: 1, serviceDate: "2026-09-29" }] },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: placeholder.id, startDate: "2026-09-29", endDate: "2026-09-29", datesChanged: true }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-09-29", endDate: "2026-10-23", datesChanged: true }),
        ]);
    });

    it("leaves a same-day zero-length terminated placeholder alone when the first session does not move earlier", async () => {
        const placeholder = placeholderOn("2026-10-01", "01", 704);
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const plan = await confirmedAssignments(successorOwnsAllSource(successor, [placeholder]), headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: placeholder.id, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: false }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("moves none of several same-day zero-length terminated placeholders and keeps the successor's start", async () => {
        const first = placeholderOn("2026-10-01", "01", 704);
        const second = placeholderOn("2026-10-01", "02", 705);
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const plan = await confirmedAssignments(
            successorOwnsAllSource(successor, [first, second]),
            { sessions: [{ sessionIndex: 1, serviceDate: "2026-09-29" }] },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: first.id, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: false }),
            expect.objectContaining({ assignmentId: second.id, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: false }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("keeps blocking when a non-placeholder terminated neighbour abuts the first active start", async () => {
        // T [09-25,10-01] is a real (non-zero-length) period ending on B's start: it is a boundary, not a
        // placeholder, so B's start must not move to 09-29 and T must not move.
        const real = {
            ...terminated,
            startDate: "2026-09-25",
            scheduleStartDate: "2026-09-25",
            endDate: "2026-10-01",
            scheduleEndDate: "2026-10-01",
        };
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const plan = await confirmedAssignments(
            successorOwnsAllSource(successor, [real]),
            { sessions: [{ sessionIndex: 1, serviceDate: "2026-09-29" }] },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: real.id, startDate: "2026-09-25", endDate: "2026-10-01", datesChanged: false }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("lets the last active end follow a later last session and moves the same-day zero-length terminated placeholder after it", async () => {
        // Mirror: B [10-01,10-23] owns every session; T is stored [10-23,10-23] and owns nothing.
        const placeholder = placeholderOn("2026-10-23", "03", 704);
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const plan = await confirmedAssignments(
            successorOwnsAllSource(successor, [placeholder], "others-last"),
            { sessions: [{ sessionIndex: 15, serviceDate: "2026-10-27" }] },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-27", datesChanged: true }),
            expect.objectContaining({ assignmentId: placeholder.id, startDate: "2026-10-27", endDate: "2026-10-27", datesChanged: true }),
        ]);
    });

    it("keeps the placeholder and the successor's start when the first session moves later (inward)", async () => {
        // T [10-01,10-01] owns nothing; B [10-01,10-23] owns every session. Sessions 1 and 2 move later
        // (first now 10-03): an inward move never pulls the shared boundary apart, so T and B keep their dates.
        const placeholder = placeholderOn("2026-10-01", "01", 704);
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const plan = await confirmedAssignments(
            successorOwnsAllSource(successor, [placeholder]),
            { sessions: [{ sessionIndex: 1, serviceDate: "2026-10-03" }, { sessionIndex: 2, serviceDate: "2026-10-04" }] },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: placeholder.id, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: false }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("keeps the placeholder and the last active end when the last session moves earlier (inward)", async () => {
        const placeholder = placeholderOn("2026-10-23", "03", 704);
        const successor = { ...caregiverB, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" };
        const plan = await confirmedAssignments(
            successorOwnsAllSource(successor, [placeholder], "others-last"),
            {
                sessions: [
                    { sessionIndex: 11, serviceDate: "2026-10-17" },
                    { sessionIndex: 12, serviceDate: "2026-10-18" },
                    { sessionIndex: 13, serviceDate: "2026-10-19" },
                    { sessionIndex: 14, serviceDate: "2026-10-20" },
                    { sessionIndex: 15, serviceDate: "2026-10-22" },
                ],
            },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-10-01", endDate: "2026-10-23", datesChanged: false }),
            expect.objectContaining({ assignmentId: placeholder.id, startDate: "2026-10-23", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("treats a same-day placeholder as the head side whatever the source order of identical stored periods", async () => {
        // B stored [10-01,10-01] owns the sessions and the placeholder is listed AFTER it: the sort still puts
        // the session-less terminated one first, so the first session moving to 09-29 carries both.
        const placeholder = placeholderOn("2026-10-01", "01", 704);
        const successor = {
            ...caregiverB,
            startDate: "2026-10-01",
            scheduleStartDate: "2026-10-01",
            endDate: "2026-10-01",
            scheduleEndDate: "2026-10-01",
        };
        const plan = await confirmedAssignments(
            successorOwnsAllSource(successor, [placeholder], "others-last"),
            { sessions: [{ sessionIndex: 1, serviceDate: "2026-09-29" }] },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: placeholder.id, startDate: "2026-09-29", endDate: "2026-09-29", datesChanged: true }),
            expect.objectContaining({ assignmentId: successor.id, startDate: "2026-09-29" }),
        ]);
    });

    it("never writes a conflict for a pause between caregivers: the later caregiver's period is a record only", async () => {
        // A [10-01,10-14] (replaced) owns every session (9); B [10-22,10-23] owns none. Sessions 8 and 9
        // move to 10-15 and 10-16, which lie in neither period's outer reach for B. The confirm succeeds and
        // keeps both stored periods untouched.
        const pausedB = { ...caregiverB, startDate: "2026-10-22", scheduleStartDate: "2026-10-22" };
        const planned = [...dates.slice(0, 7), "2026-10-15", "2026-10-16"];
        const source: ServiceRecordEditSource = {
            ...handoverSource([written(1, caregiverA)]),
            requiredSessionCount: 9,
            endDate: "2026-10-23",
            assignments: [caregiverA, pausedB],
            plannedSessions: [...dates.slice(0, 7), "2026-10-22", "2026-10-23"].map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: caregiverA.id,
                scheduleId: caregiverA.scheduleId,
                employeeId: caregiverA.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, {
            sessions: [
                { sessionIndex: 8, serviceDate: planned[7]! },
                { sessionIndex: 9, serviceDate: planned[8]! },
            ],
        });
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-14", datesChanged: false }),
            expect.objectContaining({ assignmentId: pausedB.id, startDate: "2026-10-22", endDate: "2026-10-23", datesChanged: false }),
        ]);
    });

    it("flags an assignment whose employee_schedule disagrees with the computed dates", async () => {
        const drifted = { ...caregiverB, scheduleStartDate: "2026-10-12" };
        const source: ServiceRecordEditSource = {
            ...handoverSource([written(1, caregiverA), written(8, caregiverB)]),
            assignments: [caregiverA, drifted],
        };
        const plan = await confirmedAssignments(source, headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23", datesChanged: true }),
        ]);
    });

    it("flags no assignment as changed when a confirm leaves every date alone", async () => {
        const plan = await confirmedAssignments(
            handoverSource([written(1, caregiverA), written(8, caregiverB)]),
            headerOnly,
        );
        expect(plan.assignments).toHaveLength(2);
        expect(plan.assignments.map((assignment) => assignment.datesChanged)).toEqual([false, false]);
    });

    it("flags only the outer-edge assignment whose dates actually move", async () => {
        const moved = ["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"];
        const plan = await confirmedAssignments(
            handoverSource([written(1, caregiverA), written(8, caregiverB)]),
            { sessions: moved.map((serviceDate, offset) => ({ sessionIndex: offset + 7, serviceDate })) },
        );
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: caregiverA.id, datesChanged: false }),
            expect.objectContaining({ assignmentId: caregiverB.id, datesChanged: true }),
        ]);
    });

    it("flags a moved start and leaves a session-less neighbour unflagged", async () => {
        const single = {
            ...caregiverB,
            startDate: "2026-09-28",
            scheduleStartDate: "2026-09-28",
            endDate: "2026-10-23",
            scheduleEndDate: "2026-10-23",
        };
        const early = {
            ...terminated,
            startDate: "2026-09-01",
            scheduleStartDate: "2026-09-01",
            endDate: "2026-09-05",
            scheduleEndDate: "2026-09-05",
        };
        const plan = await confirmedAssignments(singleOwnerSource(single, early, "extra-first"), headerOnly);
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: early.id, datesChanged: false }),
            expect.objectContaining({ assignmentId: single.id, datesChanged: true }),
        ]);
    });

    it("still moves a single caregiver's end with the last session", async () => {
        const single = {
            ...caregiverB,
            startDate: "2026-10-01",
            scheduleStartDate: "2026-10-01",
            endDate: "2026-10-23",
            scheduleEndDate: "2026-10-23",
        };
        const source = {
            ...handoverSource([written(1, single)]),
            assignments: [single],
            plannedSessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: single.id,
                scheduleId: single.scheduleId,
                employeeId: single.employeeId,
                provenanceVersion: "case-7",
            })),
        };
        const plan = await confirmedAssignments(source, { sessions: [{ sessionIndex: 15, serviceDate: "2026-10-26" }] });
        expect(plan.assignments).toEqual([
            expect.objectContaining({ assignmentId: single.id, scheduleId: 702, startDate: "2026-10-01", endDate: "2026-10-26" }),
        ]);
    });
});
