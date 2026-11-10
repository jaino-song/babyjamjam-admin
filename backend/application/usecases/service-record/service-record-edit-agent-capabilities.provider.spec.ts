import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DiscoveryService } from "@nestjs/core";
import { generateText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { AgentActionPreviewSchema } from "@babyjamjam/shared";
import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { AgentFlagsService } from "application/agent/agent-flags.service";
import type { AgentContext } from "application/agent/agent-context";
import { CAPABILITY_CATALOG, CAPABILITY_CATALOG_BY_NAME } from "application/agent/capability-catalog";
import { CapabilityRegistryService } from "application/agent/capability-registry.service";
import { CapabilityRouterService } from "application/agent/capability-router.service";
import type { CapabilityDefinition } from "application/agent/capability.types";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordEditConflictError } from "domain/errors/service-record-edit.error";
import type {
    ServiceRecordEditConfirmPlan,
    ServiceRecordEditDraft,
    ServiceRecordEditSource,
} from "domain/repositories/service-record-edit.repository.interface";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { createHolidayCalendarStub } from "../../../test/utils/holiday-calendar.stub";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { ServiceRecordEditAgentCapabilitiesProvider } from "./service-record-edit-agent-capabilities.provider";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_BRANCH_ID = "99999999-9999-4999-8999-999999999999";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const ACTION_ID = "66666666-6666-4666-8666-666666666666";
const CLIENT_ID = 101;
const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// The real incident (synthetic ids): A served 10-01, was replaced when service resumed on 10-14 by B.
const OLD_DATES = [
    "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13",
    "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
];
const LEGACY_EXPIRY_NOTE = "활성 링크 만료를 새 종료일 기준으로 맞춰요. 나중에 다시 보낸 링크도 이 시각으로 바뀔 수 있어요.";

// Written down by hand from the calendar, not computed with the code under test.
const NEW_DATES = [
    "2026-10-01", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21",
    "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02",
];
const GOLDEN_RESUME = { kind: "resumeReplan", fromSessionIndex: 2, resumeDate: "2026-10-14" } as const;

const principal: VerifiedTenantPrincipal = { userId: ACTOR_ID, branchId: BRANCH_ID, globalRole: "user", branchRole: "manager" };

function context(extra: Partial<AgentContext> = {}, who: VerifiedTenantPrincipal = principal): AgentContext {
    return { principal: who, sessionId: "session-1", traceId: "trace-1", locale: "ko", ...extra };
}

// --- Source fixtures (copied from test/services/admin-service-record-edit.service.spec.ts) -----------------------

function sourceSnapshot(): ServiceRecordEditSource {
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
        sessions: [{
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
        }],
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
    } as unknown as ServiceRecordEditSource;
}

/** Three planned days, one written (and locked) row, one caregiver. */
function smallSource(): ServiceRecordEditSource {
    const base = sourceSnapshot();
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03"];
    // The stored period equals the planned days, so a change that moves no date writes no period.
    const assignment = {
        ...base.assignments[0]!, id: A_ID,
        startDate: dates[0]!, endDate: dates.at(-1)!, scheduleStartDate: dates[0]!, scheduleEndDate: dates.at(-1)!,
    };
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
            assignmentId: A_ID,
            scheduleId: assignment.scheduleId,
            employeeId: assignment.employeeId,
            provenanceVersion: "case-7",
        })),
    };
}

function goldenSource(): ServiceRecordEditSource {
    const base = smallSource();
    const row = (index: number) => ({
        ...base.sessions[0]!,
        id: `day-${index}`,
        sourceRowId: `day-${index}`,
        scheduleId: index === 1 ? 55 : 56,
        sessionIndex: index,
        rawCaseSessionIndex: index,
        rawSessionIndex: index,
        serviceDate: OLD_DATES[index - 1]!,
        answers: { bath: "실시" },
        notes: `메모 ${index}`,
        momApproval: "approved",
        clientSignature: "signature",
        clientSignedAt: `${NEW_DATES[index - 1]}T09:00:00.000Z`,
        locked: true,
        // 18:00 KST on the date the session is about to get, so the golden case has no warnings.
        submittedAt: `${NEW_DATES[index - 1]}T09:00:00.000Z`,
        employeeId: index === 1 ? 9 : 10,
        employeeNameSnapshot: index === 1 ? "관리사A" : "관리사B",
    });
    const assignmentA = {
        ...base.assignments[0]!,
        id: A_ID, scheduleId: 55, employeeId: 9, employeeName: "관리사A", primaryEmployeeId: 9, primaryEmployeeName: "관리사A",
        startDate: "2026-10-01", endDate: "2026-10-14", scheduleStartDate: "2026-10-01", scheduleEndDate: "2026-10-14", replaced: true,
    };
    const assignmentB = {
        ...assignmentA,
        id: B_ID, scheduleId: 56, employeeId: 10, employeeName: "관리사B", primaryEmployeeId: 10, primaryEmployeeName: "관리사B",
        startDate: "2026-10-14", endDate: "2026-10-23", scheduleStartDate: "2026-10-14", scheduleEndDate: "2026-10-23", replaced: false,
    };
    return {
        ...base,
        caseLifecycle: { ...base.caseLifecycle, finalizationDueAt: "2026-10-23T11:00:00.000Z" },
        requiredSessionCount: OLD_DATES.length,
        startDate: OLD_DATES[0]!,
        endDate: OLD_DATES.at(-1)!,
        client: { ...base.client, startDate: OLD_DATES[0]!, endDate: OLD_DATES.at(-1)! },
        sessions: OLD_DATES.map((_date, offset) => row(offset + 1)),
        assignments: [assignmentA, assignmentB],
        plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
            sessionIndex: offset + 1,
            serviceDate,
            originalDate: serviceDate,
            assignmentId: offset === 0 ? A_ID : B_ID,
            scheduleId: offset === 0 ? 55 : 56,
            employeeId: offset === 0 ? 9 : 10,
            provenanceVersion: "case-7",
        })),
    } as ServiceRecordEditSource;
}

/** Resume day: only session 1 is written (by A), the persisted vector still gives every session to A, B took over on 10-14. */
function resumeDaySource(): ServiceRecordEditSource {
    const base = goldenSource();
    return {
        ...base,
        sessions: base.sessions.slice(0, 1),
        plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
            sessionIndex: offset + 1,
            serviceDate,
            originalDate: serviceDate,
            assignmentId: A_ID,
            scheduleId: 55,
            employeeId: 9,
            provenanceVersion: "case-7",
        })),
    } as ServiceRecordEditSource;
}

/** The resume-day source with a second live caregiver, so the incoming one has to be asked for. */
function twoSuccessorsSource(): ServiceRecordEditSource {
    const source = resumeDaySource();
    return {
        ...source,
        assignments: [...source.assignments, {
            ...source.assignments[1]!, id: C_ID, scheduleId: 57, employeeId: 11, employeeName: "관리사C",
            primaryEmployeeId: 11, primaryEmployeeName: "관리사C",
        }],
    } as ServiceRecordEditSource;
}

// --- A small stateful stand-in for the editor repository -----------------------------------------------------------

interface RepositoryOptions {
    drafts?: ServiceRecordEditDraft[];
    /** Runs right before `confirmDraft` hands the locked snapshot to the real planner. */
    beforeConfirm?: (state: RepositoryState) => void;
    /** The first `findActiveDraft` answers "none" even though a draft exists: a person opening the editor in between. */
    hideDraftOnce?: boolean;
}

interface RepositoryState {
    source: ServiceRecordEditSource;
    drafts: ServiceRecordEditDraft[];
    confirmed: Array<{ draftId: string; idempotencyKey: string; previewId: string; plan: ServiceRecordEditConfirmPlan }>;
    /** Active-token expiry writes of confirms that made no revision: [end date, mode]. */
    tokenWrites: Array<[string, "exact" | "raise_only"]>;
    /** Expiry (ISO) of each active link of the case; an exact write resets every one that differs, like the repository. */
    tokenExpiries: string[];
    /** The next `findActiveDraft` answers "none" even if a draft exists: a person opening the editor in between. */
    hideDraftOnce: boolean;
}

function personDraft(overrides: Partial<ServiceRecordEditDraft> = {}): ServiceRecordEditDraft {
    return {
        id: "77777777-7777-4777-8777-777777777777",
        branchId: BRANCH_ID,
        serviceRecordCaseId: CASE_ID,
        createdByUserId: OTHER_USER_ID,
        updatedByUserId: OTHER_USER_ID,
        discardedByUserId: null,
        sourceCaseVersion: 7,
        sourceFingerprint: "someone-elses",
        sourceSnapshot: { caseId: CASE_ID },
        changes: { header: { babyName: "직접 수정" } },
        draftVersion: 3,
        status: "ACTIVE",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        updatedAt: new Date("2026-10-01T01:00:00.000Z"),
        discardedAt: null,
        confirmedByUserId: null,
        confirmedAt: null,
        confirmationIdempotencyKey: null,
        confirmationFingerprint: null,
        confirmationResponse: null,
        ...overrides,
    };
}

function createRepository(source: ServiceRecordEditSource, options: RepositoryOptions = {}) {
    const state: RepositoryState = { source, drafts: (options.drafts ?? []).map((draft) => structuredClone(draft)), confirmed: [], tokenWrites: [], tokenExpiries: [], hideDraftOnce: options.hideDraftOnce === true };
    let sequence = 0;
    const copy = <T>(value: T): T => structuredClone(value);
    const find = (branchId: string, draftId: string) => state.drafts.find((draft) => draft.branchId === branchId && draft.id === draftId);
    const active = (branchId: string, caseId: string) => state.drafts.find((draft) => (
        draft.branchId === branchId && draft.serviceRecordCaseId === caseId && draft.status === "ACTIVE"
    ));
    type DraftInput = { branchId: string; serviceRecordCaseId: string; actorUserId: string; sourceCaseVersion: number; sourceFingerprint: string; sourceSnapshot: unknown };
    const insertDraft = (input: DraftInput): ServiceRecordEditDraft => {
        sequence += 1;
        const created: ServiceRecordEditDraft = personDraft({
            id: `00000000-0000-4000-8000-00000000000${sequence}`,
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
            sourceCaseVersion: input.sourceCaseVersion,
            sourceFingerprint: input.sourceFingerprint,
            sourceSnapshot: input.sourceSnapshot as ServiceRecordEditDraft["sourceSnapshot"],
            changes: {},
            draftVersion: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        state.drafts.push(created);
        return copy(created);
    };
    const repository = {
        loadSource: jest.fn(async (branchId: string) => (branchId === state.source.client.branchId ? copy(state.source) : null)),
        findActiveDraft: jest.fn(async (branchId: string, caseId: string) => {
            if (state.hideDraftOnce) {
                state.hideDraftOnce = false;
                return null;
            }
            const found = active(branchId, caseId);
            return found ? copy(found) : null;
        }),
        createOrResumeDraft: jest.fn(async (input: DraftInput) => {
            const existing = active(input.branchId, input.serviceRecordCaseId);
            return existing ? copy(existing) : insertDraft(input);
        }),
        // Like the real adapter: decided against the stored state at the moment of creation, never hands a draft back.
        createDraftIfNoneActive: jest.fn(async (input: DraftInput) => (
            active(input.branchId, input.serviceRecordCaseId) ? null : insertDraft(input)
        )),
        // The confirm's read-only inputs: same draft row, the branch-owned source, no revision facts.
        loadConfirmSnapshot: jest.fn(async (branchId: string, draftId: string) => {
            const found = find(branchId, draftId);
            return found && branchId === state.source.client.branchId ? { draft: copy(found), source: copy(state.source) } : null;
        }),
        findDraft: jest.fn(async (branchId: string, _caseId: string, draftId: string) => {
            const found = find(branchId, draftId);
            return found ? copy(found) : null;
        }),
        findDraftById: jest.fn(async (branchId: string, draftId: string) => {
            const found = find(branchId, draftId);
            return found ? copy(found) : null;
        }),
        updateDraft: jest.fn(async (input: { branchId: string; draftId: string; expectedDraftVersion: number; actorUserId: string; changes: unknown }) => {
            const found = find(input.branchId, input.draftId);
            if (!found || found.status !== "ACTIVE" || found.draftVersion !== input.expectedDraftVersion) {
                throw new ServiceRecordEditConflictError("The service-record draft version is stale");
            }
            found.changes = copy(input.changes) as ServiceRecordEditDraft["changes"];
            found.draftVersion += 1;
            found.updatedByUserId = input.actorUserId;
            return copy(found);
        }),
        discardDraft: jest.fn(async (input: { branchId: string; draftId: string; expectedDraftVersion: number; actorUserId: string }) => {
            const found = find(input.branchId, input.draftId);
            if (!found || found.status !== "ACTIVE" || found.draftVersion !== input.expectedDraftVersion) {
                throw new ServiceRecordEditConflictError("The service-record draft version is stale");
            }
            found.status = "DISCARDED";
            found.draftVersion += 1;
            return copy(found);
        }),
        findConfirmedDraftByIdempotencyKey: jest.fn(async (branchId: string, confirmedByUserId: string, idempotencyKey: string) => {
            const found = state.drafts.find((draft) => (
                draft.branchId === branchId
                && draft.confirmedByUserId === confirmedByUserId
                && draft.confirmationIdempotencyKey === idempotencyKey
                && draft.status === "CONFIRMED"
            ));
            return found ? { confirmationResponse: copy(found.confirmationResponse) } : null;
        }),
        confirmDraft: jest.fn(async (input: {
            branchId: string;
            draftId: string;
            expectedDraftVersion: number;
            previewId: string;
            idempotencyKey: string;
            actorUserId: string;
            prepare: (snapshot: { draft: ServiceRecordEditDraft; source: ServiceRecordEditSource }) => ServiceRecordEditConfirmPlan;
        }) => {
            options.beforeConfirm?.(state);
            const found = find(input.branchId, input.draftId);
            if (!found || found.status !== "ACTIVE" || found.draftVersion !== input.expectedDraftVersion) {
                throw new ServiceRecordEditConflictError("The service-record draft version is stale");
            }
            // The real planner re-derives the preview from the locked snapshot and rejects a stale preview id.
            const plan = input.prepare({ draft: copy(found), source: copy(state.source) });
            // Like the repository (confirmDraftWithClient): the toggles are written for any plan status ...
            if (plan.clientServiceDays) {
                state.source = {
                    ...state.source,
                    client: {
                        ...state.source.client,
                        allowSaturdayService: plan.clientServiceDays.saturday,
                        allowSundayService: plan.clientServiceDays.sunday,
                        allowHolidayService: plan.clientServiceDays.holiday,
                    },
                };
                // ... and a legacy no_changes case stores its materialized vector and moves its end dates.
                const materialized = plan.materializedPlannedSessions;
                if (materialized && plan.status === "no_changes") {
                    const before = state.source;
                    state.source = {
                        ...state.source,
                        plannedSessions: materialized.plannedSessions as unknown as ServiceRecordEditSource["plannedSessions"],
                        ...(materialized.endDate && materialized.endDate !== state.source.endDate ? { endDate: materialized.endDate } : {}),
                        client: materialized.endDate ? { ...state.source.client, endDate: materialized.endDate } : state.source.client,
                    };
                    // Mirrors the repository: links are reset only when an end date actually moves.
                    const endMoved = materialized.endDate !== before.endDate || materialized.endDate !== before.client.endDate;
                    if (materialized.endDate && endMoved) {
                        state.tokenWrites.push([materialized.endDate, "exact"]);
                        const exact = getServiceRecordTokenExpiresAt(new Date(`${materialized.endDate}T00:00:00.000Z`)).toISOString();
                        state.tokenExpiries = state.tokenExpiries.map(() => exact);
                    }
                }
            }
            if (plan.status === "no_changes" && plan.tokenExpiryMode === "raise_only" && plan.endDate) {
                state.tokenWrites.push([plan.endDate, "raise_only"]);
            }
            // A confirmed plan writes both the assignment and its schedule dates.
            if (plan.status === "confirmed") {
                state.source = {
                    ...state.source,
                    assignments: state.source.assignments.map((assignment) => {
                        const write = plan.assignments.find((entry) => entry.assignmentId === assignment.id);
                        return write && write.datesChanged !== false
                            ? { ...assignment, startDate: write.startDate, endDate: write.endDate, scheduleStartDate: write.startDate, scheduleEndDate: write.endDate }
                            : assignment;
                    }),
                };
            }
            found.status = "CONFIRMED";
            found.confirmedByUserId = input.actorUserId;
            found.confirmationIdempotencyKey = input.idempotencyKey;
            found.confirmationResponse = {
                status: plan.status,
                caseId: plan.caseId,
                clientId: plan.clientId,
                draftId: found.id,
                revisionId: plan.revision ? "revision-1" : null,
                revisionNumber: plan.revision ? 1 : null,
                documentStatus: plan.documentStatus,
                confirmedAt: "2026-10-14T01:00:00.000Z",
            } as ServiceRecordEditDraft["confirmationResponse"];
            state.confirmed.push({ draftId: found.id, idempotencyKey: input.idempotencyKey, previewId: input.previewId, plan });
            return {
                status: plan.status,
                caseId: plan.caseId,
                clientId: plan.clientId,
                draftId: found.id,
                draftVersion: found.draftVersion,
                caseVersion: state.source.caseVersion + 1,
                revisionId: plan.revision ? "revision-1" : null,
                revisionNumber: plan.revision ? 1 : null,
                documentStatus: plan.documentStatus,
                confirmedAt: "2026-10-14T01:00:00.000Z",
            };
        }),
    };
    return { repository, state };
}

type Harness = ReturnType<typeof createHarness>;

function createHarness(source: ServiceRecordEditSource, options: RepositoryOptions = {}) {
    const { repository, state } = createRepository(
        { ...source, client: { ...source.client, branchId: BRANCH_ID } } as ServiceRecordEditSource,
        options,
    );
    const editor = new AdminServiceRecordEditService(repository as never, createHolidayCalendarStub());
    const provider = new ServiceRecordEditAgentCapabilitiesProvider(editor);
    const capability = provider.getCapabilities()[0]!;
    return { repository, state, editor, provider, capability };
}

function activeDrafts(harness: Harness): ServiceRecordEditDraft[] {
    return harness.state.drafts.filter((draft) => draft.status === "ACTIVE");
}

async function propose(harness: Harness, input: Record<string, unknown>, who: VerifiedTenantPrincipal = principal) {
    const parsed = harness.capability.inputSchema.parse(input);
    const inspection = await harness.capability.inspect!(context({}, who), parsed);
    return { parsed, inspection };
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
    try {
        await run();
    } catch (error) {
        if (error instanceof AgentActionCertainFailureError) return error.message;
        throw error;
    }
    throw new Error("expected an AgentActionCertainFailureError");
}

/** Approves a proposal the way the coordinator does: revalidate, then execute the approved target. */
async function approve(harness: Harness, parsed: unknown, inspection: { targetVersion?: string; targetSnapshot?: Record<string, unknown> }) {
    const approved = context({
        actionId: ACTION_ID,
        approvedTargetVersion: inspection.targetVersion!,
        approvedTargetSnapshot: inspection.targetSnapshot!,
    });
    const revalidation = await harness.capability.revalidate!(approved, parsed, inspection.targetVersion!);
    return {
        revalidation,
        run: () => harness.capability.executeApprovedTarget!(approved, parsed, inspection.targetVersion!),
    };
}

function row(label: string, before: string | null, after: string | null, note?: string) {
    return note === undefined ? { label, before, after } : { label, before, after, note };
}

const CONTRACT_NOTE = row(
    "계약서 날짜",
    null,
    null,
    "계약서 날짜는 eformsign에서 수동으로 수정해야 해요. 확정해도 계약서는 자동으로 바뀌지 않아요.",
);

function expectValidCard(inspection: { preview?: unknown }) {
    expect(AgentActionPreviewSchema.safeParse(inspection.preview).success).toBe(true);
}

describe("ServiceRecordEditAgentCapabilitiesProvider", () => {
    describe("registration", () => {
        it("declares one approval-gated reversible write whose catalog entry the registry serves", () => {
            const harness = createHarness(goldenSource());
            expect(harness.provider.getCapabilities().map((definition) => definition.meta.name)).toEqual(["service-records.edit"]);
            expect(CAPABILITY_CATALOG_BY_NAME.get("service-records.edit")).toMatchObject({
                domain: "service-records",
                risk: "reversible-write",
                approvalPolicy: "structured",
                idempotencyPolicy: "action-id",
                renderer: "action-proposal",
                sideEffect: true,
                requiredRoles: ["owner", "admin", "manager"],
            });
        });

        it("boots against the full canonical catalog and is listed only for owner, admin and manager", async () => {
            const harness = createHarness(goldenSource());
            const others: CapabilityDefinition[] = CAPABILITY_CATALOG
                .filter((entry) => entry.name !== "service-records.edit")
                .map((meta) => ({ meta, inputSchema: z.object({}), outputSchema: z.object({}), execute: jest.fn(), reconcile: jest.fn() }));
            const registry = new CapabilityRegistryService({} as DiscoveryService);
            registry.registerProviders([harness.provider, { getCapabilities: () => others }], true);
            const served = registry.get("service-records.edit");
            expect(served.meta.description).toBe(CAPABILITY_CATALOG_BY_NAME.get("service-records.edit")!.description);
            expect(served.meta.description).toContain("OMIT both handover fields");
            expect(served.meta.description).toContain("incomingEmployeeId");

            const flags = new AgentFlagsService(
                new ConfigService({ NODE_ENV: "development", AGENT_WRITE_ENABLED: "true" }),
                { execute: jest.fn().mockResolvedValue(null) } as never,
                { execute: jest.fn() } as never,
            );
            const router = new CapabilityRouterService(registry, flags);
            const text = "가상산모 산모, 10/2–10/13 중단, 10/14부터 가상관리사을로 재개";
            const names = async (role: string) => (await router.route(
                text,
                { userId: ACTOR_ID, branchId: BRANCH_ID, globalRole: role === "owner" ? "owner" : "user", branchRole: role },
            )).capabilities.map((capability) => capability.meta.name);
            for (const role of ["owner", "admin", "manager"]) expect(await names(role)).toContain("service-records.edit");
            expect(await names("user")).not.toContain("service-records.edit");
        });

        it("refuses a plain execute: a versioned action only runs through executeApprovedTarget", async () => {
            const harness = createHarness(goldenSource());
            await expect(harness.capability.execute(context(), { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }))
                .rejects.toThrow("requires an approved target");
        });
    });

    describe("employee handover and answerable refusals", () => {
        it.each([{ incomingAssignmentId: "10" }, { incomingEmployeeId: 10 }, { incomingEmployeeId: 10, incomingAssignmentId: B_ID }])("accepts employee handover input %j with golden dates and periods", async (handover) => {
            const harness = createHarness(goldenSource());
            const { inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [{
                kind: "resumeReplan", pauseStartDate: "2026-10-02", resumeDate: "2026-10-14",
                outgoingLastServedDate: "2026-10-01", ...handover,
            }] });
            expect(inspection.targetSnapshot).toMatchObject({ operations: [{ incomingAssignmentId: B_ID }] });
            expect(inspection.preview).toMatchObject({ sections: expect.arrayContaining([
                { title: "회차 날짜", rows: NEW_DATES.slice(1).map((date, i) => row(`${i + 2}회차`, OLD_DATES[i + 1]!, date)) },
                { title: "관리사 근무 기간", rows: [
                    row("관리사A", "2026-10-01 ~ 2026-10-14", "2026-10-01 ~ 2026-10-01"),
                    row("관리사B", "2026-10-14 ~ 2026-10-23", "2026-10-14 ~ 2026-11-02"),
                ] },
            ]) });
            expect(activeDrafts(harness)).toEqual([]);
        });
        it("treats the outgoing employee as a plain pause", async () => {
            const harness = createHarness(smallSource());
            const input = { clientId: CLIENT_ID, operations: [{ kind: "resumeReplan", fromSessionIndex: 2, resumeDate: "2026-09-07", incomingEmployeeId: 9 }] };
            const { inspection } = await propose(harness, input);
            const reference = await propose(createHarness(smallSource()), { ...input, operations: [{ ...input.operations[0], incomingEmployeeId: undefined }] });
            expect(inspection.preview).toEqual(reference.inspection.preview);
            expect(inspection.targetSnapshot).toMatchObject({ operations: [{ kind: "resumeReplan", fromSessionIndex: 2, resumeDate: "2026-09-07" }] });
            expect(inspection.targetSnapshot!["operations"]).not.toEqual(expect.arrayContaining([expect.objectContaining({ incomingAssignmentId: A_ID })]));
            expect(activeDrafts(harness)).toEqual([]);
        });

        it.each([
            { incomingEmployeeId: 10, incomingAssignmentId: C_ID },
            { incomingEmployeeId: 10, incomingAssignmentId: "11" },
        ])("asks when both handover fields disagree: %j", async (fields) => {
            const harness = createHarness(twoSuccessorsSource());
            await expect(propose(harness, { clientId: CLIENT_ID, operations: [{ ...GOLDEN_RESUME, ...fields }] })).rejects.toMatchObject({ name: "AgentActionQuestionError", code: "INCOMING_ASSIGNMENT_INVALID" });
            expect(activeDrafts(harness)).toEqual([]);
        });

        it.each([false, true])("refuses duplicate usable assignments for an employee (legacy=%s)", async (legacy) => {
            const source = twoSuccessorsSource();
            source.assignments[2] = { ...source.assignments[2]!, employeeId: 10 };
            const harness = createHarness(source);
            await expect(propose(harness, { clientId: CLIENT_ID, operations: [{ ...GOLDEN_RESUME, ...(legacy ? { incomingAssignmentId: "10" } : { incomingEmployeeId: 10 }) }] })).rejects.toMatchObject({ name: "AgentActionQuestionError", code: "INCOMING_ASSIGNMENT_INVALID" });
            expect(activeDrafts(harness)).toEqual([]);
        });

        it.each([
            new ForbiddenException(),
            new ConflictException({ code: "UNKNOWN_CONFLICT", message: "알 수 없는 충돌이에요." }),
            new ConflictException({ code: "toString", message: "알 수 없는 충돌이에요." }),
        ])("keeps an unknown editor failure fatal", async (failure) => {
            const harness = createHarness(goldenSource());
            jest.spyOn(harness.editor, "updateDraft").mockRejectedValueOnce(failure);
            await expect(propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] })).rejects.toMatchObject({ name: "AgentActionCertainFailureError" });
            expect(activeDrafts(harness)).toEqual([]);
        });

        it("fails safely when an answerable refusal's transient draft cannot be discarded", async () => {
            const harness = createHarness(goldenSource());
            harness.repository.discardDraft.mockRejectedValueOnce(new Error("cleanup unavailable"));
            await expect(propose(harness, { clientId: CLIENT_ID, operations: [{ ...GOLDEN_RESUME, incomingEmployeeId: 999 }] })).rejects.toMatchObject({ name: "AgentActionCertainFailureError", message: expect.stringContaining("DRAFT_CLEANUP_FAILED") });
        });

        it.each([
            ["unknown employee", goldenSource, { ...GOLDEN_RESUME, incomingEmployeeId: 999 }, "INCOMING_ASSIGNMENT_INVALID", [{ employeeId: 10, employeeName: "관리사B" }]],
            ["ambiguous successors", twoSuccessorsSource, GOLDEN_RESUME, "INCOMING_ASSIGNMENT_REQUIRED", [{ employeeId: 10, employeeName: "관리사B" }, { employeeId: 11, employeeName: "관리사C" }]],
            ["weekend", goldenSource, { ...GOLDEN_RESUME, resumeDate: "2026-10-17" }, "RESUME_DATE_NOT_BUSINESS_DAY", []],
        ] as const)("raises an answerable %s and discards its draft", async (_label, source, operation, code, candidates) => {
            const harness = createHarness(source());
            await expect(propose(harness, { clientId: CLIENT_ID, operations: [operation] })).rejects.toMatchObject({ name: "AgentActionQuestionError", code, candidates });
            expect(activeDrafts(harness)).toEqual([]);
            expect(harness.repository.confirmDraft).not.toHaveBeenCalled();
        });
    });

    describe("inspect: one editor change at a time", () => {
        it("proposes the golden 가상산모 resume with the editor's own rows and leaves no draft behind", async () => {
            const harness = createHarness(goldenSource());
            const { inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });

            expect(inspection.preview).toEqual({
                sections: [
                    {
                        title: "회차 날짜",
                        rows: Array.from({ length: 14 }, (_unused, offset) => row(`${offset + 2}회차`, OLD_DATES[offset + 1]!, NEW_DATES[offset + 1]!)),
                    },
                    {
                        title: "관리사 근무 기간",
                        rows: [
                            row("관리사A", "2026-10-01 ~ 2026-10-14", "2026-10-01 ~ 2026-10-01"),
                            row("관리사B", "2026-10-14 ~ 2026-10-23", "2026-10-14 ~ 2026-11-02"),
                        ],
                    },
                    {
                        title: "서비스 기간·마감",
                        rows: [
                            row("서비스 종료일", "2026-10-23", "2026-11-02"),
                            // Finalization: 2026-11-02T11:00Z; link: 2026-11-09T15:00Z, shown in Korean time.
                            row("최종 확정 마감", "2026-10-23 20:00 KST", "2026-11-02 20:00 KST"),
                            row("제공기록 링크 만료", "2026-10-31 00:00 KST", "2026-11-10 00:00 KST",
                                "연장만 반영돼요(raise-only): 이미 더 늦게 만료되는 링크는 그대로 둬요"),
                        ],
                    },
                    { title: "확인할 사항", rows: [CONTRACT_NOTE] },
                ],
            });
            expectValidCard(inspection);
            expect(inspection.title).toBe("제공기록지 수정 · 산모");
            expect(inspection.summary).toBe("산모 제공기록지: 2회차부터 2026-10-14에 재개");
            expect(inspection.targetSnapshot).toMatchObject({ clientId: CLIENT_ID, caseId: CASE_ID, sourceCaseVersion: 7 });
            expect(activeDrafts(harness)).toEqual([]);
            expect(harness.repository.confirmDraft).not.toHaveBeenCalled();
        });

        it("shows exactly the rows of the editor's own preview", async () => {
            const harness = createHarness(goldenSource());
            const { inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });

            const direct = createHarness(goldenSource());
            const started = await direct.editor.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
            const patched = await direct.editor.updateDraft(BRANCH_ID, started.draft!.id, ACTOR_ID, {
                expectedDraftVersion: 1, changes: {}, resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" },
            } as never);
            const editorPreview = await direct.editor.previewDraft(BRANCH_ID, started.draft!.id, ACTOR_ID, { expectedDraftVersion: patched.draft!.draftVersion });

            const changed = editorPreview.after.sessions
                .filter((entry, index) => entry.serviceDate !== editorPreview.before.sessions[index]!.serviceDate)
                .map((entry) => [`${entry.sessionIndex}회차`, editorPreview.before.sessions[entry.sessionIndex - 1]!.serviceDate, entry.serviceDate]);
            const dates = (inspection.preview as { sections: Array<{ title: string; rows: Array<{ label: string; before: string; after: string }> }> })
                .sections.find((section) => section.title === "회차 날짜")!.rows;
            expect(dates.map((entry) => [entry.label, entry.before, entry.after])).toEqual(changed);
            expect(editorPreview.blockingReasons).toEqual([]);
        });

        it("proposes a single wrong 회차 date (dateMove)", async () => {
            const harness = createHarness(goldenSource());
            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "dateMove", sessionIndex: 15, toDate: "2026-10-26", shiftFollowing: false }],
            });
            expect(inspection.preview).toEqual({
                sections: [
                    { title: "회차 날짜", rows: [row("15회차", "2026-10-23", "2026-10-26")] },
                    // Confirm re-derives B's period from the last planned day: 10-14 ~ 10-23 becomes 10-14 ~ 10-26.
                    { title: "관리사 근무 기간", rows: [row("관리사B", "2026-10-14 ~ 2026-10-23", "2026-10-14 ~ 2026-10-26")] },
                    {
                        title: "서비스 기간·마감",
                        rows: [
                            row("서비스 종료일", "2026-10-23", "2026-10-26"),
                            row("최종 확정 마감", "2026-10-23 20:00 KST", "2026-10-26 20:00 KST"),
                            row("제공기록 링크 만료", "2026-10-31 00:00 KST", "2026-11-03 00:00 KST", "새 종료일 기준으로 맞춰요"),
                        ],
                    },
                    { title: "확인할 사항", rows: [CONTRACT_NOTE] },
                ],
            });
            expect(activeDrafts(harness)).toEqual([]);
        });

        it.each(["FINALIZING", "FINALIZATION_FAILED", "DOCUMENTS_CREATED", "COMPLETED"])("does not show a deadline write for a finalized %s case", async (status) => {
            const source = goldenSource();
            source.caseLifecycle = { ...source.caseLifecycle, status };
            const { inspection } = await propose(createHarness(source), {
                clientId: CLIENT_ID,
                operations: [{ kind: "dateMove", sessionIndex: 15, toDate: "2026-10-26", shiftFollowing: false }],
            });
            expect(JSON.stringify(inspection.preview)).not.toContain("최종 확정 마감");
        });

        it("shows B's period write for a plain date move, and binds it into the approval", async () => {
            const input = { clientId: CLIENT_ID, operations: [{ kind: "dateMove", sessionIndex: 15, toDate: "2026-10-26", shiftFollowing: false }] };
            const { inspection } = await propose(createHarness(goldenSource()), input);
            const sections = (inspection.preview as { sections: Array<{ title: string; rows: unknown[] }> }).sections;
            expect(sections.map((section) => section.title)).toContain("관리사 근무 기간");
            expect(sections.find((section) => section.title === "관리사 근무 기간")!.rows)
                .toEqual([row("관리사B", "2026-10-14 ~ 2026-10-23", "2026-10-14 ~ 2026-10-26")]);

            // The same proposal over a source whose B period differs is a different approval.
            const source = goldenSource();
            source.assignments = source.assignments.map((entry) => (entry.id === B_ID
                ? { ...entry, endDate: "2026-10-22", scheduleEndDate: "2026-10-22" } : entry));
            const other = await propose(createHarness(source), input);
            expect(other.inspection.targetVersion).not.toBe(inspection.targetVersion);
        });

        it("proposes a weekday-pattern change (schedule)", async () => {
            const harness = createHarness(smallSource());
            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{
                    kind: "schedule",
                    serviceDays: { saturday: true, sunday: false, holiday: false },
                    dates: ["2026-09-01", "2026-09-02", "2026-09-05"],
                }],
            });
            expect(inspection.preview).toEqual({
                sections: [
                    { title: "회차 날짜", rows: [row("3회차", "2026-09-03", "2026-09-05")] },
                    { title: "관리사 근무 기간", rows: [row("제공자", "2026-09-01 ~ 2026-09-03", "2026-09-01 ~ 2026-09-05")] },
                    {
                        title: "서비스 기간·마감",
                        rows: [
                            row("서비스 종료일", "2026-09-03", "2026-09-05"),
                            row("최종 확정 마감", null, "2026-09-05 20:00 KST"),
                            row("제공기록 링크 만료", "2026-09-11 00:00 KST", "2026-09-13 00:00 KST", "새 종료일 기준으로 맞춰요"),
                        ],
                    },
                    { title: "서비스 요일", rows: [row("토요일 서비스", "아니오", "예")] },
                    { title: "확인할 사항", rows: [CONTRACT_NOTE] },
                ],
            });
            expectValidCard(inspection);
        });

        it("proposes a 회차 content change, one answer key per row (sessionContent)", async () => {
            const harness = createHarness(smallSource());
            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "sessionContent", sessionIndex: 1, notes: "특이사항 없음", answers: { bath: "실시", perineum: ["이상없음"] } }],
            });
            expect(inspection.preview).toEqual({
                sections: [{
                    title: "회차 내용",
                    rows: [
                        row("1회차 · 답변 bath", null, "실시"),
                        row("1회차 · 메모", null, "특이사항 없음"),
                    ],
                }],
            });
            expectValidCard(inspection);
        });

        it("proposes a header change (header)", async () => {
            const harness = createHarness(smallSource());
            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "header", header: { babyWeight: "3.5", babyName: "아기" } }],
            });
            // babyName is unchanged, so only the weight is shown.
            expect(inspection.preview).toEqual({
                sections: [{ title: "제공기록지 헤더", rows: [row("신생아 몸무게", "3.2", "3.5")] }],
            });
        });

        it("applies several operations in order to one draft (header + dateMove)", async () => {
            const harness = createHarness(smallSource());
            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [
                    { kind: "header", header: { babyWeight: "3.5" } },
                    { kind: "dateMove", sessionIndex: 3, toDate: "2026-09-04" },
                ],
            });
            expect(inspection.preview).toEqual({
                sections: [
                    { title: "회차 날짜", rows: [row("3회차", "2026-09-03", "2026-09-04")] },
                    { title: "관리사 근무 기간", rows: [row("제공자", "2026-09-01 ~ 2026-09-03", "2026-09-01 ~ 2026-09-04")] },
                    {
                        title: "서비스 기간·마감",
                        rows: [
                            row("서비스 종료일", "2026-09-03", "2026-09-04"),
                            row("최종 확정 마감", null, "2026-09-04 20:00 KST"),
                            row("제공기록 링크 만료", "2026-09-11 00:00 KST", "2026-09-12 00:00 KST", "새 종료일 기준으로 맞춰요"),
                        ],
                    },
                    { title: "제공기록지 헤더", rows: [row("신생아 몸무게", "3.2", "3.5")] },
                    { title: "확인할 사항", rows: [CONTRACT_NOTE] },
                ],
            });
            expect(inspection.summary).toBe("산모 제공기록지: 헤더 수정(신생아 몸무게), 3회차를 2026-09-04로 이동");
            // One editor save per operation, in order.
            expect(harness.repository.updateDraft).toHaveBeenCalledTimes(2);
            expect(activeDrafts(harness)).toEqual([]);
        });

        it("says nothing about the contract when the observed scope has none linked", async () => {
            const source = { ...smallSource(), documentScope: {
                evidence: "observed",
                serviceRecordSnapshot: { documentIds: [], snapshotVersion: null, chunks: [] },
                currentRevision: { id: null, revisionNumber: null, formVersion: null },
                form: { version: 3 },
                contract: { currentDocumentId: null, stage: null },
            } } as ServiceRecordEditSource;
            const harness = createHarness(source);
            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "dateMove", sessionIndex: 3, toDate: "2026-09-04" }],
            });
            expect(JSON.stringify(inspection.preview)).not.toContain("eformsign");
        });

        it("resolves a pause start date to the first 회차 on or after it", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "resumeReplan", pauseStartDate: "2026-10-02", resumeDate: "2026-10-14" }],
            });
            expect(inspection.targetSnapshot).toMatchObject({ operations: [GOLDEN_RESUME] });
            const reference = await propose(createHarness(goldenSource()), { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            expect(inspection.preview).toEqual(reference.inspection.preview);
            expect(parsed).toBeDefined();
        });

        it("splits a long section at 60 rows and keeps every row", async () => {
            const dates: string[] = [KR_BUILTIN_CALENDAR.nextBusinessDay("2026-11-02")];
            while (dates.length < 70) dates.push(KR_BUILTIN_CALENDAR.addBusinessDays(dates.at(-1)!, 1));
            const base = smallSource();
            const long = {
                ...base,
                requiredSessionCount: 70,
                startDate: dates[0]!,
                endDate: dates.at(-1)!,
                sessions: [],
                client: { ...base.client, startDate: dates[0]!, endDate: dates.at(-1)! },
                caseLifecycle: { ...base.caseLifecycle, finalizationDueAt: null },
                plannedSessions: dates.map((serviceDate, index) => ({
                    sessionIndex: index + 1, serviceDate, originalDate: serviceDate, assignmentId: A_ID, scheduleId: 55, employeeId: 9, provenanceVersion: "case-7",
                })),
            } as ServiceRecordEditSource;
            const harness = createHarness(long);
            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "dateMove", sessionIndex: 1, toDate: KR_BUILTIN_CALENDAR.addBusinessDays(dates[0]!, 1) }],
            });
            const sections = (inspection.preview as { sections: Array<{ title: string; rows: unknown[] }> }).sections;
            expect(sections.slice(0, 2).map((section) => [section.title, section.rows.length])).toEqual([["회차 날짜 (1/2)", 60], ["회차 날짜 (2/2)", 10]]);
            expectValidCard(inspection);
        });

        it("refuses, as a question, a value the card cannot show in full instead of truncating it", async () => {
            const source = smallSource();
            source.sessions = source.sessions.map((session) => ({ ...session, notes: "가".repeat(260) }));
            const harness = createHarness(source);
            const message = await rejection(() => propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "sessionContent", sessionIndex: 1, notes: "짧은 메모" }],
            }));
            expect(message).toContain("[CARD_TOO_LARGE]");
            expect(activeDrafts(harness)).toEqual([]);
        });

        it("refuses a change that changes nothing", async () => {
            const harness = createHarness(smallSource());
            const message = await rejection(() => propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "header", header: { babyWeight: "3.2" } }],
            }));
            expect(message).toContain("바뀌는 내용이 없어요");
            expect(activeDrafts(harness)).toEqual([]);
        });
    });

    describe("inspect: questions instead of guesses", () => {
        it("asks for the incoming 관리사 with the candidates, then succeeds with the picked id", async () => {
            const harness = createHarness(twoSuccessorsSource());
            const asked = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(asked).toContain("[INCOMING_ASSIGNMENT_REQUIRED]");
            expect(asked).toContain("관리사B(employeeId: 10)");
            expect(asked).toContain("관리사C(employeeId: 11)");
            expect(activeDrafts(harness)).toEqual([]);

            const { inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ ...GOLDEN_RESUME, incomingAssignmentId: C_ID }],
            });
            expect(inspection.summary).toContain("(관리사 교체)");
            const periods = (inspection.preview as { sections: Array<{ title: string; rows: Array<{ label: string }> }> })
                .sections.find((section) => section.title === "관리사 근무 기간")!.rows.map((entry) => entry.label);
            expect(periods).toContain("관리사C");
            expectValidCard(inspection);
        });

        it("lets the model reach the question through the AI SDK tool loop", async () => {
            const harness = createHarness(twoSuccessorsSource());
            const prompts: string[] = [];
            let calls = 0;
            const model = new MockLanguageModelV3({
                doGenerate: async (options) => {
                    prompts.push(JSON.stringify(options.prompt));
                    calls += 1;
                    if (calls === 1) {
                        return {
                            content: [{ type: "tool-call", toolCallId: "call-1", toolName: "edit", input: JSON.stringify({ clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }) }],
                            finishReason: { unified: "tool-calls", raw: "tool-calls" },
                            usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
                            warnings: [],
                        };
                    }
                    return {
                        content: [{ type: "text", text: "누가 이어서 일하나요?" }],
                        finishReason: { unified: "stop", raw: "stop" },
                        usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
                        warnings: [],
                    };
                },
            });
            // The runtime hands the tool the same function and lets a thrown error reach the next model step.
            const result = await generateText({
                model,
                prompt: "가상산모 산모 10/14부터 재개",
                tools: { edit: tool({ inputSchema: z.object({}).passthrough(), execute: (input) => harness.capability.inspect!(context(), harness.capability.inputSchema.parse(input)) }) },
                stopWhen: ({ steps }) => steps.length >= 2,
            });
            expect(result.text).toBe("누가 이어서 일하나요?");
            expect(prompts[1]).toContain("INCOMING_ASSIGNMENT_REQUIRED");
            expect(prompts[1]).toContain("관리사C(employeeId: 11)");
        });

        it("tells the model to omit incomingAssignmentId when the current 관리사 is named for a plain pause", async () => {
            const harness = createHarness(resumeDaySource());
            const message = await rejection(() => propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ ...GOLDEN_RESUME, incomingAssignmentId: A_ID }],
            }));
            expect(message).toContain("[INCOMING_ASSIGNMENT_INVALID]");
            expect(message).toContain("incomingAssignmentId를 빼고");
            // The plain pause itself works.
            await expect(propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] })).resolves.toBeDefined();
        });

        it.each([
            ["a Saturday resume date", { ...GOLDEN_RESUME, resumeDate: "2026-10-17" }, "[RESUME_DATE_NOT_BUSINESS_DAY]"],
            ["a session index past N", { ...GOLDEN_RESUME, fromSessionIndex: 16 }, "[INVALID_SESSION_INDEX]"],
            ["an impossible date", { ...GOLDEN_RESUME, resumeDate: "2026-02-30" }, "[INVALID_DATE]"],
        ])("answers %s with the editor's code, never a raw error", async (_label, operation, code) => {
            const harness = createHarness(goldenSource());
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [operation] }));
            expect(message).toContain(code);
            expect(activeDrafts(harness)).toEqual([]);
        });

        it("explains a resume combined with a date move across operations", async () => {
            const harness = createHarness(goldenSource());
            const message = await rejection(() => propose(harness, {
                clientId: CLIENT_ID,
                operations: [GOLDEN_RESUME, { kind: "dateMove", sessionIndex: 15, toDate: "2026-11-03" }],
            }));
            expect(message).toContain("[RESUME_REPLAN_COMBINATION]");
            expect(activeDrafts(harness)).toEqual([]);
        });

        it("reports the preview's blocking reasons, such as a finalized case", async () => {
            const source = { ...goldenSource() };
            source.caseLifecycle = { ...source.caseLifecycle, status: "COMPLETED" };
            const harness = createHarness(source);
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(message).toContain("[CASE_FINALIZED]");
            expect(activeDrafts(harness)).toEqual([]);
        });

        it.each([
            ["a missing resume date", { kind: "resumeReplan", fromSessionIndex: 2 }, "resumeDate"],
            ["a resume without a starting 회차", { kind: "resumeReplan", resumeDate: "2026-10-14" }, "fromSessionIndex"],
            ["a dateMove without a target", { kind: "dateMove", sessionIndex: 3 }, "toDate"],
            ["an empty content change", { kind: "sessionContent", sessionIndex: 1 }, "바꿀 내용"],
            ["an empty header", { kind: "header", header: {} }, "바꿀 헤더 값"],
        ])("asks the user for %s instead of guessing, before any draft exists", async (_label, operation, missingField) => {
            const harness = createHarness(goldenSource());
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [operation] }));
            expect(message).toContain("[MISSING_INPUT]");
            expect(message).toContain(missingField);
            expect(harness.repository.createDraftIfNoneActive).not.toHaveBeenCalled();
        });

        it("rejects a field that does not belong to the operation, and a malformed date, through the editor's own validators", async () => {
            const harness = createHarness(goldenSource());
            expect(await rejection(() => propose(harness, {
                clientId: CLIENT_ID, operations: [{ kind: "dateMove", sessionIndex: 3, toDate: "2026-10-20", resumeDate: "2026-10-14" }],
            }))).toContain("[INVALID_OPERATION]");
            const malformed = await rejection(() => propose(harness, {
                clientId: CLIENT_ID, operations: [{ ...GOLDEN_RESUME, resumeDate: "10/14" }],
            }));
            expect(malformed).toContain("[INVALID_INPUT]");
            expect(malformed).toContain("resumeReplan.resumeDate");
            expect(harness.repository.createDraftIfNoneActive).not.toHaveBeenCalled();
        });

        it("asks for the client when none was given", async () => {
            const harness = createHarness(goldenSource());
            expect(await rejection(() => propose(harness, { operations: [GOLDEN_RESUME] }))).toContain("clientId");
            expect(await rejection(() => propose(harness, { clientId: CLIENT_ID }))).toContain("operations");
        });
    });

    describe("the 관리사 근무 기간 rows come from the confirm's own plan", () => {
        interface Period { name: string; start: string; end: string; scheduleStart: string; scheduleEnd: string }
        const periodsOf = (source: ServiceRecordEditSource): Map<string, Period> => new Map(source.assignments.map((assignment) => [
            assignment.id!,
            {
                name: assignment.employeeName!,
                start: assignment.startDate,
                end: assignment.endDate,
                scheduleStart: assignment.scheduleStartDate!,
                scheduleEnd: assignment.scheduleEndDate!,
            },
        ]));
        const cardPeriodRows = (inspection: { preview?: unknown }) => (
            (inspection.preview as { sections: Array<{ title: string; rows: Array<{ label: string; before: string; after: string }> }> })
                .sections.find((section) => section.title === "관리사 근무 기간")?.rows ?? []
        );

        /** Proposes, approves and runs a real confirm on the stateful repository; returns the card's rows and what the rows then hold. */
        async function cardAndWrites(harness: Harness, input: Record<string, unknown>) {
            const before = periodsOf(harness.state.source);
            const { parsed, inspection } = await propose(harness, input);
            const rows = cardPeriodRows(inspection);
            await (await approve(harness, parsed, inspection)).run();
            const after = periodsOf(harness.state.source);
            const written = [...after.entries()].filter(([id, period]) => JSON.stringify(period) !== JSON.stringify(before.get(id)));
            return { rows, before, after, written };
        }
        /** The card lists exactly the assignments whose assignment or schedule dates the confirm changed. */
        function expectRowsToEqualWrites(result: Awaited<ReturnType<typeof cardAndWrites>>) {
            expect(result.rows.map((entry) => [entry.label, entry.after])).toEqual(
                result.written.map(([, period]) => [period.name, `${period.start} ~ ${period.end}`]),
            );
            for (const [, period] of result.written) {
                // Both tables hold the same, final dates.
                expect([period.scheduleStart, period.scheduleEnd]).toEqual([period.start, period.end]);
            }
        }

        it("A: shows a schedule-only change (assignment already ends 09-03, schedule still ends 09-15)", async () => {
            const source = smallSource();
            source.assignments = source.assignments.map((entry) => ({ ...entry, scheduleEndDate: "2026-09-15" }));
            const harness = createHarness(source);
            const result = await cardAndWrites(harness, { clientId: CLIENT_ID, operations: [{ kind: "header", header: { babyWeight: "3.5" } }] });
            expect(result.rows).toEqual([row("제공자", "2026-09-01 ~ 2026-09-03 (일정 2026-09-01 ~ 2026-09-15)", "2026-09-01 ~ 2026-09-03")]);
            expect(result.after.get(A_ID)).toMatchObject({ end: "2026-09-03", scheduleEnd: "2026-09-03" });
            expectRowsToEqualWrites(result);
        });

        it.each([
            ["empty notes", { notes: "" }],
            ["whitespace notes", { notes: "   " }],
            ["empty etcService", { etcService: "" }],
            ["empty answers", { answers: {} }],
            ["paymentConfirmed false", { paymentConfirmed: false }],
        ])("B: %s on a future 회차 changes nothing, so no card is offered and a real confirm is a no-op", async (_label, content) => {
            const source = smallSource();
            source.assignments = source.assignments.map((entry) => ({ ...entry, endDate: "2026-09-15", scheduleEndDate: "2026-09-15" }));
            const harness = createHarness(source);
            const before = structuredClone(harness.state.source.assignments);
            const message = await rejection(() => propose(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "sessionContent", sessionIndex: 2, ...content }],
            }));
            // Every variant reaches the editor and the real planner says no_changes: the existing refusal.
            expect(message).toContain("바뀌는 내용이 없어요");
            expect(activeDrafts(harness)).toEqual([]);

            // The editor itself agrees: confirming the same patch is a no-op that writes no period.
            const started = await harness.editor.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
            const saved = await harness.editor.updateDraft(BRANCH_ID, started.draft!.id, ACTOR_ID, {
                expectedDraftVersion: 1, changes: { sessions: [{ sessionIndex: 2, ...content }] },
            } as never);
            const preview = await harness.editor.previewDraft(BRANCH_ID, started.draft!.id, ACTOR_ID, { expectedDraftVersion: saved.draft!.draftVersion });
            const confirmed = await harness.editor.confirmDraft(BRANCH_ID, started.draft!.id, ACTOR_ID, {
                expectedDraftVersion: saved.draft!.draftVersion, previewId: preview.previewId, idempotencyKey: "88888888-8888-4888-8888-888888888888",
            });
            expect(confirmed.status).toBe("no_changes");
            expect(harness.state.source.assignments).toEqual(before);
        });

        it("golden dateMove (회차 15 to 10-26): only 관리사B's period, equal to what the confirm writes", async () => {
            const harness = createHarness(goldenSource());
            const result = await cardAndWrites(harness, {
                clientId: CLIENT_ID,
                operations: [{ kind: "dateMove", sessionIndex: 15, toDate: "2026-10-26", shiftFollowing: false }],
            });
            expect(result.rows).toEqual([row("관리사B", "2026-10-14 ~ 2026-10-23", "2026-10-14 ~ 2026-10-26")]);
            expectRowsToEqualWrites(result);
        });

        it("golden resume: the rows are the plan's changed periods, equal to what the confirm writes", async () => {
            const harness = createHarness(goldenSource());
            const result = await cardAndWrites(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            expect(result.rows).toEqual([
                row("관리사A", "2026-10-01 ~ 2026-10-14", "2026-10-01 ~ 2026-10-01"),
                row("관리사B", "2026-10-14 ~ 2026-10-23", "2026-10-14 ~ 2026-11-02"),
            ]);
            expectRowsToEqualWrites(result);
        });

        it("header-only on a consistent source lists no period", async () => {
            const harness = createHarness(goldenSource());
            const result = await cardAndWrites(harness, { clientId: CLIENT_ID, operations: [{ kind: "header", header: { babyWeight: "3.5" } }] });
            expect(result.rows).toEqual([]);
            expect(result.written).toEqual([]);
        });
    });

    describe("writes the confirm makes without a revision (plan.status no_changes)", () => {
        const KEEP_DATES = ["2026-09-01", "2026-09-02", "2026-09-03"];
        const saturdayOn = { saturday: true, sunday: false, holiday: false };
        const sectionTitles = (inspection: { preview?: unknown }) => (inspection.preview as { sections: Array<{ title: string }> }).sections.map((entry) => entry.title);
        const sectionRows = (inspection: { preview?: unknown }, title: string) => (
            (inspection.preview as { sections: Array<{ title: string; rows: Array<{ label: string; before: string | null; after: string | null; note?: string }> }> })
                .sections.find((entry) => entry.title === title)?.rows ?? []
        );
        const toggleOnly = { clientId: CLIENT_ID, operations: [{ kind: "schedule", serviceDays: saturdayOn, dates: KEEP_DATES }] };

        it("a toggle-only service-day change is offered, approved and stored (no period row)", async () => {
            const harness = createHarness(smallSource());
            const { parsed, inspection } = await propose(harness, toggleOnly);
            expect(sectionTitles(inspection)).toEqual(["서비스 요일"]);
            expect(sectionRows(inspection, "서비스 요일")).toEqual([row("토요일 서비스", "아니오", "예")]);
            expectValidCard(inspection);

            const { run } = await approve(harness, parsed, inspection);
            const result = await run() as { status: string };
            expect(result.status).toBe("no_changes");
            expect(harness.state.source.client).toMatchObject({ allowSaturdayService: true, allowSundayService: false, allowHolidayService: false });
            expect(harness.state.confirmed[0]!.plan).toMatchObject({ status: "no_changes", clientServiceDays: saturdayOn });
            expect(activeDrafts(harness)).toEqual([]);
        });

        it("occurrence 1: a toggle on a stored-vector case offers no end-date or expiry row, and the confirm leaves the ends alone", async () => {
            // The vector ends 09-03 but the case and client end 09-15: the toggle-only confirm writes neither.
            const source = { ...smallSource(), endDate: "2026-09-15" } as ServiceRecordEditSource;
            source.client = { ...source.client, endDate: "2026-09-15" };
            const harness = createHarness(source);
            const { parsed, inspection } = await propose(harness, toggleOnly);
            expect(sectionTitles(inspection)).toEqual(["서비스 요일"]);
            expect(sectionRows(inspection, "서비스 요일")).toEqual([row("토요일 서비스", "아니오", "예")]);
            await (await approve(harness, parsed, inspection)).run();
            expect(harness.state.source.endDate).toBe("2026-09-15");
            expect(harness.state.source.client).toMatchObject({ endDate: "2026-09-15", allowSaturdayService: true });
            expect(harness.state.tokenWrites).toEqual([]);
            expect(harness.state.confirmed[0]!.plan.finalizationDueAt).toBeUndefined();
        });

        it("occurrence 2: a no-op content patch beside the toggle adds no content row, and no content is written", async () => {
            const harness = createHarness(smallSource());
            const sessionsBefore = structuredClone(harness.state.source.sessions);
            const { parsed, inspection } = await propose(harness, {
                clientId: CLIENT_ID,
                operations: [toggleOnly.operations[0], { kind: "sessionContent", sessionIndex: 2, paymentConfirmed: false }],
            });
            expect(sectionTitles(inspection)).toEqual(["서비스 요일"]);
            await (await approve(harness, parsed, inspection)).run();
            const plan = harness.state.confirmed[0]!.plan;
            expect(plan.status).toBe("no_changes");
            // No session row is added; the plan only echoes the stored value of the one row it knows.
            expect(plan.newSessions).toEqual([]);
            expect(plan.sessions).toEqual([expect.objectContaining({ sourceRowId: "day-1", paymentConfirmed: false, notes: null })]);
            expect(harness.state.source.sessions).toEqual(sessionsBefore);
            expect(harness.state.source.client).toMatchObject({ allowSaturdayService: true });
        });

        it("a legacy case whose client end differs from the case end shows the client end row too", async () => {
            const source = { ...smallSource(), plannedSessions: null, requiredSessionCount: 3, endDate: "2026-09-15" } as unknown as ServiceRecordEditSource;
            source.client = { ...source.client, endDate: "2026-09-10" };
            const harness = createHarness(source);
            const { parsed, inspection } = await propose(harness, toggleOnly);
            expect(sectionRows(inspection, "서비스 기간·마감").map((entry) => [entry.label, entry.before, entry.after])).toEqual([
                ["서비스 종료일", "2026-09-15", "2026-09-03"],
                ["고객 정보의 서비스 종료일", "2026-09-10", "2026-09-03"],
                ["최종 확정 마감", null, "2026-09-03 20:00 KST"],
                ["제공기록 링크 만료", null, "2026-09-11 00:00 KST"],
            ]);
            await (await approve(harness, parsed, inspection)).run();
            expect(harness.state.source.endDate).toBe("2026-09-03");
            expect(harness.state.source.client.endDate).toBe("2026-09-03");
        });

        it("a legacy case (no stored vector) discloses the vector and end the toggle stores, and stores exactly that", async () => {
            const source = { ...smallSource(), plannedSessions: null, requiredSessionCount: 3, endDate: "2026-09-15" } as unknown as ServiceRecordEditSource;
            source.client = { ...source.client, endDate: "2026-09-15" };
            const harness = createHarness(source);
            const { parsed, inspection } = await propose(harness, toggleOnly);
            expect(sectionTitles(inspection)).toContain("서비스 요일");
            const { run } = await approve(harness, parsed, inspection);
            await run();
            const confirmed = harness.state.confirmed[0]!.plan;
            expect(confirmed.status).toBe("no_changes");
            // The plan's vector (what is stored) has the kept dates and the end the card shows.
            expect(confirmed.materializedPlannedSessions?.endDate).toBe("2026-09-03");
            expect(confirmed.finalizationDueAt).toBe("2026-09-03T11:00:00.000Z");
            expect((confirmed.materializedPlannedSessions?.plannedSessions as unknown as Array<{ serviceDate: string }>).map((entry) => entry.serviceDate))
                .toEqual(KEEP_DATES);
            const stored = harness.state.source.plannedSessions as unknown as Array<{ sessionIndex: number; serviceDate: string }>;
            expect(stored.map((entry) => entry.serviceDate)).toEqual(KEEP_DATES);
            // The card's end-date and link-expiry rows equal what the confirm stored.
            const endRow = sectionRows(inspection, "서비스 기간·마감").find((entry) => entry.label === "서비스 종료일");
            expect(endRow).toEqual(row("서비스 종료일", "2026-09-15", harness.state.source.endDate));
            expect(harness.state.source.endDate).toBe("2026-09-03");
            expect(harness.state.source.client.endDate).toBe("2026-09-03");
            expect(sectionRows(inspection, "서비스 기간·마감").find((entry) => entry.label === "제공기록 링크 만료"))
                .toEqual(row("제공기록 링크 만료", null, "2026-09-11 00:00 KST", LEGACY_EXPIRY_NOTE));
            expect(harness.state.tokenWrites).toEqual([["2026-09-03", "exact"]]);
        });

        it("a legacy toggle that keeps both ends shows no link-expiry row and leaves a later-reissued link alone", async () => {
            // Dates 09-01..03 and both ends 09-03; an admin re-sent the link late, so it expires 2026-11-04T03:00Z.
            const source = { ...smallSource(), plannedSessions: null, requiredSessionCount: 3, endDate: "2026-09-03" } as unknown as ServiceRecordEditSource;
            source.client = { ...source.client, endDate: "2026-09-03" };
            const harness = createHarness(source);
            harness.state.tokenExpiries = ["2026-11-04T03:00:00.000Z"];
            const { parsed, inspection } = await propose(harness, toggleOnly);
            expect(sectionTitles(inspection)).toEqual(["서비스 요일"]);
            expect(sectionRows(inspection, "서비스 요일")).toEqual([row("토요일 서비스", "아니오", "예")]);
            await (await approve(harness, parsed, inspection)).run();
            const confirmed = harness.state.confirmed[0]!.plan;
            expect(confirmed.status).toBe("no_changes");
            expect(confirmed.materializedPlannedSessions?.endDate).toBe("2026-09-03");
            expect(harness.state.source.client).toMatchObject({ allowSaturdayService: true, endDate: "2026-09-03" });
            expect(harness.state.tokenWrites).toEqual([]);
            expect(harness.state.tokenExpiries).toEqual(["2026-11-04T03:00:00.000Z"]);
        });

        it("a resume that finds every date right still discloses and executes the raise-only link expiry", async () => {
            const golden = goldenSource();
            const resumed = {
                ...golden,
                endDate: "2026-11-02",
                client: { ...golden.client, endDate: "2026-11-02" },
                caseLifecycle: { ...golden.caseLifecycle, finalizationDueAt: "2026-11-02T11:00:00.000Z" },
                sessions: golden.sessions.map((entry, offset) => ({ ...entry, serviceDate: NEW_DATES[offset]! })),
                assignments: golden.assignments.map((entry) => (entry.id === A_ID
                    ? { ...entry, endDate: "2026-10-01", scheduleEndDate: "2026-10-01" }
                    : { ...entry, endDate: "2026-11-02", scheduleEndDate: "2026-11-02" })),
                plannedSessions: NEW_DATES.map((serviceDate, offset) => ({
                    sessionIndex: offset + 1, serviceDate, originalDate: serviceDate,
                    assignmentId: offset === 0 ? A_ID : B_ID, scheduleId: offset === 0 ? 55 : 56, employeeId: offset === 0 ? 9 : 10,
                    provenanceVersion: "case-7",
                })),
            } as ServiceRecordEditSource;
            const harness = createHarness(resumed);
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            expect(sectionTitles(inspection)).toContain("서비스 기간·마감");
            expect(sectionRows(inspection, "서비스 기간·마감")).toEqual([
                row("제공기록 링크 만료", null, "2026-11-10 00:00 KST", "연장만 반영돼요(raise-only): 이미 더 늦게 만료되는 링크는 그대로 둬요"),
            ]);
            expect(sectionTitles(inspection)).not.toContain("관리사 근무 기간");
            const { run } = await approve(harness, parsed, inspection);
            expect((await run() as { status: string }).status).toBe("no_changes");
            expect(harness.state.tokenWrites).toEqual([["2026-11-02", "raise_only"]]);
        });

        it("a draft-creation REQUEST_CONFLICT is the open-draft question, but another 409 is not", async () => {
            const harness = createHarness(goldenSource());
            jest.spyOn(harness.editor, "startOwnDraft").mockRejectedValueOnce(new ConflictException({
                code: "SERVICE_RECORD_WRITE_TARGET_CHANGED", message: "stale",
            }));
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(message).toContain("[SERVICE_RECORD_WRITE_TARGET_CHANGED]");
            expect(message).not.toContain("EDITOR_DRAFT_OPEN");
            expect(activeDrafts(harness)).toEqual([]);
        });
    });

    describe("a person's editor draft", () => {
        it("is reported, never reused, changed or discarded", async () => {
            const person = personDraft();
            const harness = createHarness(goldenSource(), { drafts: [person] });
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(message).toContain("[EDITOR_DRAFT_OPEN]");
            expect(message).toContain("다른 사용자");
            expect(harness.repository.createDraftIfNoneActive).not.toHaveBeenCalled();
            expect(harness.repository.updateDraft).not.toHaveBeenCalled();
            expect(harness.repository.discardDraft).not.toHaveBeenCalled();
            expect(harness.state.drafts).toEqual([person]);
        });

        it("is left alone when it appears between the check and the start", async () => {
            const person = personDraft({ createdByUserId: ACTOR_ID });
            const harness = createHarness(goldenSource(), { drafts: [person], hideDraftOnce: true });
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(message).toContain("[EDITOR_DRAFT_OPEN]");
            expect(message).toContain("본인");
            expect(harness.repository.updateDraft).not.toHaveBeenCalled();
            expect(harness.repository.discardDraft).not.toHaveBeenCalled();
            expect(harness.state.drafts).toEqual([person]);
        });

        it("is never taken over when the same person has just opened a fresh empty draft (look misses, start would resume)", async () => {
            const harness = createHarness(goldenSource());
            // The manager opens the editor: the editor's own start gives a genuine empty version-1 draft.
            const opened = (await harness.editor.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {})).draft!;
            expect(opened).toMatchObject({ draftVersion: 1, status: "ACTIVE", createdByUserId: ACTOR_ID });
            const before = structuredClone(harness.state.drafts);
            harness.repository.updateDraft.mockClear();
            harness.repository.discardDraft.mockClear();
            // ...in the instant between the chat's look at the case and its own start.
            harness.state.hideDraftOnce = true;

            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(message).toContain("[EDITOR_DRAFT_OPEN]");
            expect(message).toContain("본인");
            expect(harness.repository.updateDraft).not.toHaveBeenCalled();
            expect(harness.repository.discardDraft).not.toHaveBeenCalled();
            expect(harness.state.drafts).toEqual(before);
            expect(activeDrafts(harness)).toHaveLength(1);
            expect(activeDrafts(harness)[0]).toMatchObject({ id: opened.id, draftVersion: 1, status: "ACTIVE" });
        });

        it("makes the approval refuse instead of confirming over it", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            const person = personDraft();
            harness.state.drafts.push(person);
            const { revalidation, run } = await approve(harness, parsed, inspection);
            expect(revalidation.valid).toBe(false);
            expect(await rejection(run)).toContain("[EDITOR_DRAFT_OPEN]");
            expect(harness.repository.confirmDraft).not.toHaveBeenCalled();
            // The only discard is the proposal's own transient draft, from before the person appeared.
            expect(harness.repository.discardDraft).toHaveBeenCalledTimes(1);
            expect(harness.repository.discardDraft.mock.calls[0]![0]).not.toMatchObject({ draftId: person.id });
            expect(harness.state.drafts.find((draft) => draft.id === person.id)).toEqual(person);
        });
    });

    describe("scope", () => {
        it("cannot see another branch's client", async () => {
            const harness = createHarness(goldenSource());
            const message = await rejection(() => propose(
                harness,
                { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] },
                { ...principal, branchId: OTHER_BRANCH_ID },
            ));
            expect(message).toContain("[NOT_FOUND]");
            expect(harness.repository.createDraftIfNoneActive).not.toHaveBeenCalled();
        });

        it("takes the branch only from the principal", () => {
            const harness = createHarness(goldenSource());
            const parsed = harness.capability.inputSchema.parse({ clientId: CLIENT_ID, branchId: OTHER_BRANCH_ID, operations: [GOLDEN_RESUME] });
            expect(parsed).not.toHaveProperty("branchId");
        });
    });

    describe("approval", () => {
        it("confirms exactly the preview that was approved, keyed by the action id", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            const { revalidation, run } = await approve(harness, parsed, inspection);
            expect(revalidation.valid).toBe(true);

            const result = await run();
            expect(result).toMatchObject({ status: "confirmed", caseId: CASE_ID, clientId: CLIENT_ID, revisionNumber: 1 });
            expect(harness.repository.confirmDraft).toHaveBeenCalledTimes(1);
            const [confirmed] = harness.state.confirmed;
            expect(confirmed!.idempotencyKey).toBe(ACTION_ID);
            expect(confirmed!.previewId).toMatch(/^srp_[0-9a-f]{64}$/);
            // The writes are the rows the card showed.
            expect(confirmed!.plan.endDate).toBe("2026-11-02");
            expect(confirmed!.plan.finalizationDueAt).toBe("2026-11-02T11:00:00.000Z");
            expect(confirmed!.plan.tokenExpiryMode).toBe("raise_only");
            expect(confirmed!.plan.assignments.map(({ assignmentId, startDate, endDate }) => [assignmentId, startDate, endDate])).toEqual([
                [A_ID, "2026-10-01", "2026-10-01"],
                [B_ID, "2026-10-14", "2026-11-02"],
            ]);
            expect((confirmed!.plan.plannedSessions as Array<Record<string, unknown>>).map((entry) => entry["serviceDate"])).toEqual(NEW_DATES);
            expect(activeDrafts(harness)).toEqual([]);
            expect(harness.state.drafts.map((draft) => draft.status)).toEqual(["DISCARDED", "CONFIRMED"]); // the proposal's own transient draft, then the approved one
        });

        it("applies the approved snapshot, not the model's input", async () => {
            const harness = createHarness(goldenSource());
            const { inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            const tampered = { clientId: CLIENT_ID, operations: [{ kind: "dateMove", sessionIndex: 15, toDate: "2026-11-03" }] };
            const { run } = await approve(harness, tampered, inspection);
            await run();
            expect((harness.state.confirmed[0]!.plan.plannedSessions as Array<Record<string, unknown>>).map((entry) => entry["serviceDate"])).toEqual(NEW_DATES);
        });

        it("refuses at revalidate when the case or its version moved", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            harness.state.source = { ...harness.state.source, caseVersion: 8 };
            expect((await approve(harness, parsed, inspection)).revalidation.valid).toBe(false);

            const changed = createHarness(goldenSource());
            const second = await propose(changed, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            changed.state.source = { ...changed.state.source, header: { ...changed.state.source.header, babyName: "다른 아기" } };
            expect((await approve(changed, second.parsed, second.inspection)).revalidation.valid).toBe(false);
        });

        it("refuses at execute, confirming nothing, when the recomputed change differs from the approved one", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            // Skip revalidate: execute must stand on its own.
            harness.state.source = { ...harness.state.source, header: { ...harness.state.source.header, babyName: "다른 아기" } };
            const approved = context({ actionId: ACTION_ID, approvedTargetVersion: inspection.targetVersion!, approvedTargetSnapshot: inspection.targetSnapshot! });
            const message = await rejection(() => harness.capability.executeApprovedTarget!(approved, parsed, inspection.targetVersion!));
            expect(message).toContain("[APPROVAL_STALE]");
            expect(harness.repository.confirmDraft).not.toHaveBeenCalled();
            expect(activeDrafts(harness)).toEqual([]);
        });

        it("refuses a different target version than the approved one", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            const approved = context({ actionId: ACTION_ID, approvedTargetVersion: "other", approvedTargetSnapshot: inspection.targetSnapshot! });
            expect(await rejection(() => harness.capability.executeApprovedTarget!(approved, parsed, "other"))).toContain("[APPROVAL_STALE]");
            expect(harness.repository.confirmDraft).not.toHaveBeenCalled();
        });

        it("turns a concurrent change between preview and confirm into a certain failure and discards its own draft", async () => {
            let armed = false;
            const harness = createHarness(goldenSource(), {
                beforeConfirm: (state) => {
                    if (armed) state.source = { ...state.source, header: { ...state.source.header, babyName: "그 사이에 바뀜" } };
                },
            });
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            armed = true;
            const { run } = await approve(harness, parsed, inspection);
            const message = await rejection(run);
            expect(message).toContain("[SERVICE_RECORD_WRITE_TARGET_CHANGED]");
            expect(harness.state.confirmed).toEqual([]);
            expect(activeDrafts(harness)).toEqual([]);
            expect(harness.repository.discardDraft).toHaveBeenCalledTimes(2); // once after the proposal, once after the failed confirm
        });

        it("does not discard a draft a person has changed since this call saw it", async () => {
            const harness = createHarness(goldenSource());
            harness.repository.updateDraft.mockImplementationOnce(async (input: { branchId: string; draftId: string; expectedDraftVersion: number }) => {
                // A person saves the very draft this call just started.
                const found = harness.state.drafts.find((draft) => draft.id === input.draftId)!;
                found.draftVersion += 1;
                throw new ServiceRecordEditConflictError("The service-record draft version is stale");
            });
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(message).toContain("[SERVICE_RECORD_WRITE_TARGET_CHANGED]");
            // The compare-and-swap discard at the old version failed, so the changed draft survives.
            expect(activeDrafts(harness)).toHaveLength(1);
            expect(activeDrafts(harness)[0]!.draftVersion).toBe(2);
        });

        it("surfaces a draft that could not be cleaned up instead of pretending", async () => {
            const harness = createHarness(goldenSource());
            harness.repository.discardDraft.mockRejectedValueOnce(new Error("database down"));
            const message = await rejection(() => propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] }));
            expect(message).toContain("[DRAFT_CLEANUP_FAILED]");
        });
    });

    describe("reconcile", () => {
        it("preserves an uncertain error after confirm commits so reconciliation can report success", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            const { run } = await approve(harness, parsed, inspection);
            const confirmDraft = harness.repository.confirmDraft.getMockImplementation()!;
            const originalError = new Error("connection reset after commit");
            harness.repository.confirmDraft.mockImplementationOnce(async (input) => {
                await confirmDraft(input);
                throw originalError;
            });

            const error = await run().catch((error: unknown) => error);
            expect(error).not.toBeInstanceOf(AgentActionCertainFailureError);
            expect(error).toBe(originalError);
            expect(harness.state.drafts.map((draft) => draft.status)).toEqual(["DISCARDED", "CONFIRMED"]);

            const outcome = await harness.capability.reconcile!(context({ actionId: ACTION_ID }), {}, null);
            expect(outcome).toMatchObject({
                status: "succeeded",
                result: { status: "confirmed", caseId: CASE_ID, clientId: CLIENT_ID, revisionNumber: 1 },
            });
            expect(harness.repository.findConfirmedDraftByIdempotencyKey).toHaveBeenCalledWith(BRANCH_ID, ACTOR_ID, ACTION_ID);
            expect(harness.repository.confirmDraft).toHaveBeenCalledTimes(1);
        });

        it("reports success from the draft this action confirmed, without confirming again", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            const { run } = await approve(harness, parsed, inspection);
            const confirmedResult = await run();
            expect(harness.repository.confirmDraft).toHaveBeenCalledTimes(1);

            const outcome = await harness.capability.reconcile!(context({ actionId: ACTION_ID }), {}, null);
            expect(outcome).toEqual({ status: "succeeded", result: confirmedResult });
            expect(harness.repository.findConfirmedDraftByIdempotencyKey).toHaveBeenCalledWith(BRANCH_ID, ACTOR_ID, ACTION_ID);
            expect(harness.repository.confirmDraft).toHaveBeenCalledTimes(1);
            expect(harness.repository.createDraftIfNoneActive).toHaveBeenCalledTimes(2); // proposal + approval only
            expect(harness.repository.createOrResumeDraft).not.toHaveBeenCalled();
        });

        it("is uncertain for another action id, another user, another branch, or no action id", async () => {
            const harness = createHarness(goldenSource());
            const { parsed, inspection } = await propose(harness, { clientId: CLIENT_ID, operations: [GOLDEN_RESUME] });
            await (await approve(harness, parsed, inspection)).run();
            const uncertain = async (ctx: AgentContext) => (await harness.capability.reconcile!(ctx, {}, null)).status;
            expect(await uncertain(context({ actionId: "77777777-7777-4777-8777-777777777777" }))).toBe("uncertain");
            expect(await uncertain(context({ actionId: ACTION_ID }, { ...principal, userId: OTHER_USER_ID }))).toBe("uncertain");
            expect(await uncertain(context({ actionId: ACTION_ID }, { ...principal, branchId: OTHER_BRANCH_ID }))).toBe("uncertain");
            expect(await uncertain(context())).toBe("uncertain");
            expect(harness.repository.confirmDraft).toHaveBeenCalledTimes(1);
        });

        it("is uncertain when the stored response is unreadable", async () => {
            const harness = createHarness(goldenSource());
            harness.repository.findConfirmedDraftByIdempotencyKey.mockResolvedValueOnce({ confirmationResponse: { status: "?" } });
            expect((await harness.capability.reconcile!(context({ actionId: ACTION_ID }), {}, null)).status).toBe("uncertain");
            harness.repository.findConfirmedDraftByIdempotencyKey.mockResolvedValueOnce({ confirmationResponse: null });
            expect((await harness.capability.reconcile!(context({ actionId: ACTION_ID }), {}, null)).status).toBe("uncertain");
        });
    });
});
