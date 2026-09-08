import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordEditConflictError } from "domain/errors/service-record-edit.error";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = 101;

function sourceSnapshot(overrides: Record<string, unknown> = {}) {
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
    };
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
    };
    const service = new AdminServiceRecordEditService(repository as never);
    return { service, repository };
}

describe("AdminServiceRecordEditService", () => {
    it("captures a realistic 14-field payload without mutating source provenance", async () => {
        const harness = createHarness();
        const changes = {
            header: { momName: "수정 산모" },
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
            changes: { header: { momName: "새 입력" } },
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

    it("rejects authority fields, duplicate sessions, and invalid dates before persistence", async () => {
        const harness = createHarness();
        const forbidden = {
            branchId: "attacker-branch",
            sessions: [{ sessionIndex: 1, serviceDate: "2026-02-30" }],
        };

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: forbidden as never,
        })).rejects.toThrow(/Unknown service-record draft field/);
        expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();

        await expect(harness.service.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {
            changes: {
                sessions: [
                    { sessionIndex: 1, serviceDate: "2026-09-01" },
                    { sessionIndex: 1, serviceDate: "2026-09-02" },
                ],
            },
        })).rejects.toThrow(/Duplicate service-record session/);
    });

    it("returns the latest safe draft state as a 409 on stale CAS", async () => {
        const active = draft({ sourceFingerprint: "old-source" });
        const latest = draft({ draftVersion: 2, changes: { header: { momName: "다른 관리자" } } });
        const harness = createHarness({ activeDraft: active });
        harness.repository.updateDraft.mockRejectedValue(new ServiceRecordEditConflictError());
        harness.repository.findDraft.mockResolvedValue(latest);

        const operation = harness.service.updateDraft(BRANCH_ID, DRAFT_ID, ACTOR_ID, {
            expectedDraftVersion: 1,
            changes: { header: { momName: "내 저장" } },
        });
        await expect(operation).rejects.toBeInstanceOf(ConflictException);
        await expect(operation).rejects.toMatchObject({
            response: expect.objectContaining({
                code: "SERVICE_RECORD_EDIT_CONFLICT",
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
        })).rejects.toThrow(/ambiguous legacy source rows/);
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
});
