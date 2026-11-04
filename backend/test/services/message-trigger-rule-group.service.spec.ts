import { MessageTriggerService } from "application/services/message-trigger.service";
import { buildClientMessageRecipe } from "application/services/message-trigger-recipes";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";

jest.mock("infrastructure/database/schema-capabilities", () => ({ hasColumn: jest.fn().mockResolvedValue(true), hasTable: jest.fn().mockResolvedValue(true) }));

describe("Phase6 CLIENT isolation", () => {
    const client = { id: 1, name: "합성 고객", phone: "01000000001", branchId: "branch-1", createdAt: new Date("2026-11-01T00:00:00Z"), startDate: null, endDate: null, serviceEndNoticeSentAt: null };
    const rule = (recipientType: MessageTriggerRecipientType) => MessageTriggerRuleEntity.create({
        branchId: "branch-1", name: "인사", eventType: MessageTriggerEventType.CLIENT_CREATED,
        offsetType: MessageTriggerOffsetType.IMMEDIATE, recipientType, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
    });
    it.each([MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerRecipientType.SECONDARY_EMPLOYEE])("refuses %s before producing any customer recipe", (recipient) => {
        expect(buildClientMessageRecipe(rule(recipient), client as never, new Date("2026-11-01T00:00:00Z"))).toBeNull();
    });
    it("keeps the CLIENT positive recipe", () => {
        expect(buildClientMessageRecipe(rule(MessageTriggerRecipientType.CLIENT), client as never, new Date("2026-11-01T00:00:00Z"))).toMatchObject({ recipientType: "CLIENT", recipientPhone: "01000000001" });
    });
});

import { ConflictException, HttpException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MessageTriggerRuleGroupService } from "application/services/message-trigger-rule-group.service";
import type { MessageTriggerRuleGroupDraft } from "application/services/message-trigger.service";
import { MessageTriggerRuleGroupEntity } from "domain/entities/message-trigger-rule-group.entity";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { mapHttpProblem } from "infrastructure/filters/problem-response";

const branch = "branch-1";
const draft = (overrides: Partial<MessageTriggerRuleGroupDraft> = {}): MessageTriggerRuleGroupDraft => ({
    name: "고객 시작 안내", recipientMode: MessageTriggerRecipientType.CLIENT,
    eventType: MessageTriggerEventType.SERVICE_START, offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
    offsetDays: 3, sendTime: "10:30", isActive: false, targetClientStatus: "all", retryOnFailure: true,
    recipientTemplates: { CLIENT: MessageTriggerTemplateKey.SERVICE_INFO }, ...overrides,
});
const cloneRule = (rule: MessageTriggerRuleEntity) => Object.assign(Object.create(MessageTriggerRuleEntity.prototype) as MessageTriggerRuleEntity, structuredClone(rule));

function coreFixture() {
    const groups: MessageTriggerRuleGroupEntity[] = [];
    const rules: MessageTriggerRuleEntity[] = [];
    const removed = new Set<string>();
    const jobs = [{ status: "canceled", canceledByUser: true }, { status: "sent", canceledByUser: false }, { status: "pending", canceledByUser: false }];
    const locks: string[] = [];
    const tx = {} as Prisma.TransactionClient;
    let queue = Promise.resolve();
    let parent = true;
    let sequence = 0;
    const repository = {
        findActiveByEventTypes: jest.fn().mockResolvedValue([]),
        findGroupDuplicateCandidates: jest.fn(async () => rules.filter((rule) => !removed.has(rule.id)).map(cloneRule)),
        findAll: jest.fn(async () => rules.filter((rule) => !removed.has(rule.id)).map(cloneRule)),
        findById: jest.fn(async (scope: string, id: string) => { const rule = rules.find((rule) => rule.id === id && rule.branchId === scope && !removed.has(id)); return rule ? cloneRule(rule) : null; }),
        findGroups: jest.fn(async (scope: string) => groups.filter((group) => group.branchId === scope && !group.deletedAt).map((group) => ({ ...group }))),
        findGroup: jest.fn(async (scope: string, id: string) => groups.find((group) => group.id === id && group.branchId === scope && !group.deletedAt) ?? null),
        lockGroup: jest.fn(async (scope: string, id: string, transaction: Prisma.TransactionClient): Promise<MessageTriggerRuleGroupEntity | null> => { expect(transaction).toBe(tx); locks.push("group"); return repository.findGroup(scope, id); }),
        lockGroupRules: jest.fn(async (_scope: string, _id: string, transaction: Prisma.TransactionClient) => { expect(transaction).toBe(tx); locks.push("children"); }),
        findGroupRules: jest.fn(async (scope: string, id: string, _transaction?: Prisma.TransactionClient, includeDeleted = false) => rules.filter((rule) => rule.branchId === scope && rule.groupId === id && (includeDeleted || !removed.has(rule.id))).map(cloneRule)),
        createGroup: jest.fn(async (scope: string, name: string, mode: MessageTriggerRuleGroupEntity["recipientMode"], transaction: Prisma.TransactionClient) => {
            expect(transaction).toBe(tx); locks.push("group");
            const group = new MessageTriggerRuleGroupEntity(`group-${++sequence}`, scope, name, mode, 1, new Date(), new Date()); groups.push(group); return group;
        }),
        create: jest.fn(async (_scope: string, rule: MessageTriggerRuleEntity, transaction: Prisma.TransactionClient) => { expect(transaction).toBe(tx); locks.push("children"); rule = cloneRule(rule); Object.assign(rule, { id: `rule-${++sequence}` }); rules.push(rule); return cloneRule(rule); }),
        markJobsStale: jest.fn(async (_scope: string, id: string, transaction: Prisma.TransactionClient) => { expect(transaction).toBe(tx); const rule = rules.find((row) => row.id === id)!; rule.jobsStale = true; }),
        updateGroupCAS: jest.fn(async (_scope: string, group: MessageTriggerRuleGroupEntity, version: number, transaction: Prisma.TransactionClient) => {
            expect(transaction).toBe(tx); const stored = groups.find((row) => row.id === group.id)!;
            if (stored.version !== version) return false; Object.assign(stored, { name: group.name, recipientMode: group.recipientMode, version: version + 1 }); return true;
        }),
        softDeleteGroup: jest.fn(async (_scope: string, id: string, transaction: Prisma.TransactionClient) => { expect(transaction).toBe(tx); const group = groups.find((row) => row.id === id)!; group.deletedAt = new Date(); group.version++; }),
        updateIfTargetMatchesAndFenceJobs: jest.fn(async (_scope: string, expected: MessageTriggerRuleEntity, next: MessageTriggerRuleEntity, _reason: string, _at: Date, transaction: Prisma.TransactionClient) => {
            expect(transaction).toBe(tx); locks.push("jobs"); const stored = rules.find((row) => row.id === expected.id)!;
            if (stored.updatedAt.getTime() !== expected.updatedAt.getTime()) return null;
            Object.assign(stored, cloneRule(next), { updatedAt: new Date(stored.updatedAt.getTime() + 1), jobsStale: true });
            jobs.filter((job) => job.status === "pending").forEach((job) => { job.status = "canceled"; }); return cloneRule(stored);
        }),
        deleteIfTargetMatchesAndFenceJobs: jest.fn(async (_scope: string, expected: MessageTriggerRuleEntity, _reason: string, _at: Date, transaction: Prisma.TransactionClient) => {
            expect(transaction).toBe(tx); locks.push("jobs"); const stored = rules.find((row) => row.id === expected.id)!;
            if (stored.updatedAt.getTime() !== expected.updatedAt.getTime()) return false; removed.add(expected.id); jobs.filter((job) => job.status === "pending").forEach((job) => { job.status = "canceled"; }); return true;
        }),
    };
    const lock = { runExclusive: jest.fn(async <T>(scope: string, work: (transaction: Prisma.TransactionClient) => Promise<T>, transaction?: Prisma.TransactionClient): Promise<T> => {
        if (transaction) return work(transaction);
        const previous = queue; let release!: () => void; queue = new Promise<void>((resolve) => { release = resolve; }); await previous;
        locks.push("branch");
        const beforeGroups = structuredClone(groups); const beforeRules = rules.map(cloneRule); const beforeJobs = structuredClone(jobs); const beforeRemoved = [...removed];
        try { return await work(tx); } catch (error) { groups.splice(0, groups.length, ...beforeGroups); rules.splice(0, rules.length, ...beforeRules); jobs.splice(0, jobs.length, ...beforeJobs); removed.clear(); beforeRemoved.forEach((id) => removed.add(id)); throw error; } finally { release(); }
    }) };
    const approval = { ensureApproved: jest.fn().mockResolvedValue(undefined), isApproved: jest.fn().mockResolvedValue(true) };
    const activation = {
        getTriggerDispatchEnabled: jest.fn(async () => parent),
        assertTriggerDispatchEnabled: jest.fn(async () => { if (!parent) throw new ConflictException("parent OFF"); }),
        activateRuleWithParent: jest.fn(async (scope: string, id: string) => { parent = true; const rule = rules.find((row) => row.id === id && row.branchId === scope)!; rule.isActive = true; return cloneRule(rule); }),
    };
    const sources = { isMessageAutomationParentEnabled: async () => parent, resolvePersistedRules: jest.fn(async (scope: string) => ({ rules: (await repository.findAll()).filter((rule) => rule.branchId === scope || rule.branchId === null).map((rule) => { if (!parent) rule.isActive = false; return rule; }), parentEnabled: parent })) };
    const templates = { getByKeyForBranch: jest.fn().mockResolvedValue({ customVariables: [] }) };
    const core = new MessageTriggerService({} as never, {} as never, approval as never, repository as never, { findPendingByRuleIdsAndClientId: async () => [] } as never, {} as never,
        templates as never, { runExclusive: async <T>(_key: unknown, work: (transaction: Prisma.TransactionClient) => Promise<T>, transaction: Prisma.TransactionClient) => { locks.push("template"); return work(transaction); } } as never,
        { getMessageAutomationPolicyConfig: async () => ({ configuration: { ...defaultMessageAutomationPolicy(), defaultRuleSendTime: "11:45" } }) } as never,
        undefined, activation as never, lock as never, sources as never);
    jest.spyOn(core as unknown as { hasTriggerSchema: () => Promise<boolean> }, "hasTriggerSchema").mockResolvedValue(true);
    const reconcile = jest.spyOn(core as unknown as { reconcileRuleGenerationAfterMutation: (scope: string, id: string) => Promise<MessageTriggerRuleEntity | null> }, "reconcileRuleGenerationAfterMutation").mockImplementation((scope, id) => repository.findById(scope, id));
    return { core, facade: new MessageTriggerRuleGroupService(core), groups, rules, jobs, removed, repository, locks, lock, approval, activation, templates, reconcile, tx, setParent: (value: boolean) => { parent = value; } };
}

describe("MessageTriggerRuleGroupService through actual trigger core", () => {
    it("creates, lists, reads, replaces and soft deletes a CLIENT singleton atomically", async () => {
        const f = coreFixture(); const created = await f.facade.create(branch, draft());
        expect(created).toMatchObject({ branchId: branch, version: 1, recipientMode: "CLIENT", sendTime: "10:30", rules: [{ groupId: created.id, recipientType: "CLIENT" }] });
        expect(await f.facade.list(branch)).toMatchObject({ groups: [{ id: created.id }], standaloneRules: [] });
        const updated = await f.facade.update(branch, created.id, { ...draft({ name: "변경", sendTime: "12:15", offsetDays: 5 }), expectedVersion: 1 });
        expect(updated).toMatchObject({ version: 2, name: "변경", sendTime: "12:15", offsetDays: 5, rules: [{ id: created.rules[0]!.id, groupId: created.id, sendTime: "12:15" }] });
        expect(f.locks.slice(-4)).toEqual(["branch", "group", "children", "jobs"]);
        await f.facade.delete(branch, created.id);
        expect(f.removed.has(created.rules[0]!.id)).toBe(true); expect(f.groups[0]!.deletedAt).toBeInstanceOf(Date);
        await expect(f.facade.get(branch, created.id)).rejects.toMatchObject({ status: 404 });
        expect(f.jobs).toEqual([{ status: "canceled", canceledByUser: true }, { status: "sent", canceledByUser: false }, { status: "canceled", canceledByUser: false }]);
    });
    it("uses the validated source default only when sendTime is omitted", async () => {
        const f = coreFixture(); expect(await f.facade.create(branch, draft({ sendTime: undefined }))).toMatchObject({ sendTime: "11:45" });
        expect(await f.facade.create(branch, draft({ sendTime: "09:15" }))).toMatchObject({ sendTime: "09:15" });
    });
    it("locks the active template before parent/child writes on create and group update", async () => {
        const f = coreFixture(); const created = await f.facade.create(branch, draft({ isActive: true }));
        expect(f.locks.slice(0, 4)).toEqual(["branch", "template", "group", "children"]);
        f.locks.length = 0;
        await f.facade.update(branch, created.id, { ...draft({ isActive: true, name: "active" }), expectedVersion: 1 });
        expect(f.locks.slice(0, 4)).toEqual(["branch", "template", "group", "children"]);
    });
    it("materializes no customer job for nonCLIENT rules and retains CLIENT positive creation", async () => {
        const f = coreFixture();
        const client = { id: 1, name: "합성", phone: "01000000001", createdAt: new Date("2026-11-01T00:00:00Z"), startDate: null, endDate: null, serviceEndNoticeSentAt: null };
        jest.spyOn(f.core, "readClientAutomationSource").mockResolvedValue(client as never);
        const persist = jest.spyOn(f.core as unknown as { persistPendingJob: (...args: unknown[]) => Promise<void> }, "persistPendingJob").mockResolvedValue(undefined);
        const nonClient = MessageTriggerRuleEntity.create({ ...draftRule(), eventType: MessageTriggerEventType.CLIENT_CREATED, offsetType: MessageTriggerOffsetType.IMMEDIATE, recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE });
        f.repository.findActiveByEventTypes.mockResolvedValue([nonClient]);
        await f.core.syncClientRulesForClient(branch, 1, false); expect(persist).not.toHaveBeenCalled();
        const customer = cloneRule(nonClient); customer.recipientType = MessageTriggerRecipientType.CLIENT;
        f.repository.findActiveByEventTypes.mockResolvedValue([customer]);
        await f.core.syncClientRulesForClient(branch, 1, false);
        expect(persist).toHaveBeenCalledTimes(1); expect(persist.mock.calls[0]![0]).toMatchObject({ recipientType: "CLIENT", recipientPhone: "01000000001" });
    });
    it("sanitizes coded semantic400 without exposing its private cause", async () => {
        const f = coreFixture(); let caught: unknown;
        try { await f.facade.create(branch, draft({ sendTime: "25:61" })); } catch (error) { caught = error; }
        const problem = mapHttpProblem(caught, { method: "POST", acceptsLanguages: () => "ko" } as never, { locals: {} } as never);
        expect(problem).toMatchObject({ status: 400, code: "VALIDATION_FAILED", outcome: "NOT_APPLIED" });
        expect(JSON.stringify(problem)).not.toMatch(/cause|stack|sendTime.*HH:mm/); expect(f.repository.create).not.toHaveBeenCalled();
    });
    it("retains branch/default/system standalone projections without duplicating children", async () => {
        const f = coreFixture(); await f.facade.create(branch, draft());
        const standalone = MessageTriggerRuleEntity.create({ ...draftRule(), isDefault: true }); Object.assign(standalone, { id: "default" }); f.rules.push(standalone);
        const global = cloneRule(standalone); global.branchId = null; Object.assign(global, { id: "system:existing" }); f.rules.push(global);
        expect((await f.facade.list(branch)).standaloneRules.map((rule) => rule.id)).toEqual(["default", "system:existing"]);
    });
    it.each(["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE", "BOTH_EMPLOYEES"] as const)("rejects new %s writes with no repository/provider effects", async (mode) => {
        const f = coreFixture(); await expect(f.facade.create(branch, draft({ recipientMode: mode as MessageTriggerRuleGroupDraft["recipientMode"] }))).rejects.toMatchObject({ status: 400 });
        expect(f.repository.createGroup).not.toHaveBeenCalled(); expect(f.repository.create).not.toHaveBeenCalled();
    });
    it.each([{ recipientTemplates: {} }, { recipientTemplates: { CLIENT: MessageTriggerTemplateKey.INFO, PRIMARY_EMPLOYEE: MessageTriggerTemplateKey.INFO } }, { sendTime: "24:00" }, { offsetDays: -1 }])("rejects invalid group draft %j", async (invalid) => {
        const f = coreFixture(); await expect(f.facade.create(branch, draft(invalid))).rejects.toMatchObject({ status: 400 }); expect(f.groups).toHaveLength(0);
    });
    it("returns fresh groupId/version on stale CAS, sanitized through actual mapHttpProblem", async () => {
        const f = coreFixture(); const created = await f.facade.create(branch, draft()); await f.facade.update(branch, created.id, { ...draft(), expectedVersion: 1 });
        let caught: unknown; try { await f.facade.update(branch, created.id, { ...draft({ name: "stale" }), expectedVersion: 1 }); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(HttpException);
        const problem = mapHttpProblem(caught, { method: "PUT", acceptsLanguages: () => "ko" } as never, { locals: {} } as never);
        expect(problem).toMatchObject({ status: 409, code: "REQUEST_CONFLICT", groupId: created.id, currentVersion: 2, outcome: "NOT_APPLIED" });
        expect(JSON.stringify(problem)).not.toMatch(/cause|stack|private|prisma|Rule changed/); expect(f.groups[0]!.version).toBe(2);
    });
    it("serializes equivalent branch creates to exactly one success and one duplicate409", async () => {
        const f = coreFixture(); const results = await Promise.allSettled([f.facade.create(branch, draft()), f.facade.create(branch, draft({ name: "다른 이름", retryOnFailure: false, isActive: true }))]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 409 } }); expect(f.groups).toHaveLength(1); expect(f.rules).toHaveLength(1);
    });
    it("normalizes SAME_DAY day counts and ignores activation/retry/name for duplicate semantics", async () => {
        const f = coreFixture(); await f.facade.create(branch, draft({ offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 0 }));
        await expect(f.facade.create(branch, draft({ offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 99, isActive: true, name: "새 이름", retryOnFailure: false }))).rejects.toMatchObject({ status: 409 });
    });
    it("rolls back both inserted parent and child if stale bookkeeping fails", async () => {
        const f = coreFixture(); f.repository.markJobsStale.mockRejectedValueOnce(new Error("private failure"));
        await expect(f.facade.create(branch, draft())).rejects.toThrow("private failure"); expect(f.groups).toHaveLength(0); expect(f.rules).toHaveLength(0);
        expect(await f.facade.create(branch, draft())).toMatchObject({ version: 1 }); expect(f.groups).toHaveLength(1); expect(f.rules).toHaveLength(1);
    });
    it("rejects cross-branch reads/updates/deletes and leaves source untouched", async () => {
        const f = coreFixture(); const created = await f.facade.create(branch, draft());
        await expect(f.facade.get("other", created.id)).rejects.toMatchObject({ status: 404 });
        await expect(f.facade.update("other", created.id, { ...draft(), expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
        await expect(f.facade.delete("other", created.id)).rejects.toMatchObject({ status: 404 }); expect(f.groups[0]!.version).toBe(1);
    });
    it("legacy POST immediately groups its child and legacy update advances the same parent", async () => {
        const f = coreFixture(); const rule = await f.core.createRule(branch, draftRule()); expect(rule.groupId).toBe(f.groups[0]!.id);
        const updated = await f.core.updateRule(branch, rule.id, { name: "legacy", sendTime: "13:20" });
        expect(updated).toMatchObject({ groupId: rule.groupId, sendTime: "13:20" }); expect(f.groups[0]).toMatchObject({ version: 2, name: "legacy" });
        await f.core.deleteRule(branch, rule.id); expect(f.groups[0]!.deletedAt).toBeInstanceOf(Date);
    });
    it("retains caller-owned transaction and postcommit reconciliation ordering", async () => {
        const f = coreFixture(); const rule = await f.core.createRule(branch, draftRule(), f.tx); expect(rule.groupId).toBe(f.groups[0]!.id); expect(f.reconcile).not.toHaveBeenCalled();
    });
    it("preserves parent OFF drafts and rejects explicit activation until enabled", async () => {
        const f = coreFixture(); f.setParent(false);
        const created = await f.facade.create(branch, draft()); expect(created.isActive).toBe(false);
        expect(await f.facade.update(branch, created.id, { ...draft({ name: "metadata" }), expectedVersion: 1 })).toMatchObject({ isActive: false, version: 2 });
        await expect(f.facade.update(branch, created.id, { ...draft({ isActive: true }), expectedVersion: 2 })).rejects.toMatchObject({ status: 409 }); expect(f.groups[0]!.version).toBe(2);
    });
    it.each(["update", "delete", "activation", "activationWithParent", "approvedUpdate", "approvedDelete"])("refuses BOTH child %s before jobs or template writes", async (writer) => {
        const f = coreFixture(); const created = await f.facade.create(branch, draft()); f.groups[0]!.recipientMode = "BOTH_EMPLOYEES";
        const rule = f.rules[0]!; const internals = f.core as unknown as { ruleTargetVersion: (rule: MessageTriggerRuleEntity) => string };
        const snapshot = { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() }; const version = internals.ruleTargetVersion(rule);
        const action = writer === "update" ? () => f.core.updateRule(branch, rule.id, { name: "bad" })
            : writer === "delete" ? () => f.core.deleteRule(branch, rule.id)
            : writer === "activation" ? () => f.core.updateRuleBranchActivation(branch, rule.id, true)
            : writer === "activationWithParent" ? () => f.core.activateRuleWithParent(branch, rule.id)
            : writer === "approvedUpdate" ? () => f.core.updateRuleApprovedTarget(branch, rule.id, { name: "bad" }, version, snapshot)
            : () => f.core.deleteRuleApprovedTarget(branch, rule.id, version, snapshot);
        await expect(action()).rejects.toMatchObject({ status: 409, response: { groupId: created.id } });
        expect(f.repository.updateIfTargetMatchesAndFenceJobs).not.toHaveBeenCalled(); expect(f.repository.deleteIfTargetMatchesAndFenceJobs).not.toHaveBeenCalled(); expect(f.groups[0]!.version).toBe(1);
    });
    it("preserves groupId and group version on approved update/delete while refusing stale snapshots", async () => {
        const f = coreFixture(); const created = await f.facade.create(branch, draft()); const rule = cloneRule(f.rules[0]!);
        const version = (f.core as unknown as { ruleTargetVersion: (rule: MessageTriggerRuleEntity) => string }).ruleTargetVersion(rule);
        const snapshot = { ...rule, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() };
        expect(await f.core.updateRuleApprovedTarget(branch, rule.id, { name: "approved" }, version, snapshot)).toMatchObject({ groupId: created.id }); expect(f.groups[0]!.version).toBe(2);
        await expect(f.core.deleteRuleApprovedTarget(branch, rule.id, version, snapshot)).rejects.toMatchObject({ status: 400 }); expect(f.groups[0]!.deletedAt).toBeNull();
    });
});

function draftRule() {
    return { name: "고객 시작 안내", eventType: MessageTriggerEventType.SERVICE_START, offsetType: MessageTriggerOffsetType.BEFORE_DAYS, offsetDays: 3, sendTime: "10:30", isActive: false, recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.SERVICE_INFO, branchId: branch };
}

describe("Phase6 C1 effective optional group-update state", () => {
    it("refuses the actual pre_booking duplicate when status is omitted and leaves state unchanged", async () => {
        const f = coreFixture();
        await f.facade.create(branch, draft({ sendTime: "09:00", targetClientStatus: "pre_booking" }));
        const target = await f.facade.create(branch, draft({ sendTime: "10:00", targetClientStatus: "pre_booking" }));
        const before = structuredClone({ groups: f.groups, rules: f.rules, jobs: f.jobs });
        const update = { ...draft({ sendTime: "09:00" }), expectedVersion: 1 };
        delete update.targetClientStatus;
        await expect(f.facade.update(branch, target.id, update)).rejects.toMatchObject({ status: 409 });
        expect(structuredClone({ groups: f.groups, rules: f.rules, jobs: f.jobs })).toEqual(before);
        expect(f.repository.updateIfTargetMatchesAndFenceJobs).not.toHaveBeenCalled();
    });

    it("allows the distinct pre_booking rule when an all-status rule already uses the requested time", async () => {
        const f = coreFixture();
        await f.facade.create(branch, draft({ sendTime: "09:00", targetClientStatus: "all" }));
        const target = await f.facade.create(branch, draft({ sendTime: "10:00", targetClientStatus: "pre_booking" }));
        const update = { ...draft({ sendTime: "09:00" }), expectedVersion: 1 };
        delete update.targetClientStatus;
        await expect(f.facade.update(branch, target.id, update)).resolves.toMatchObject({
            version: 2, sendTime: "09:00", targetClientStatus: "pre_booking",
            rules: [{ targetClientStatus: "pre_booking", sendTime: "09:00" }],
        });
    });

    it("keeps the public effective-state coded400 wrapper and excludes its private cause", async () => {
        const f = coreFixture(); const target = await f.facade.create(branch, draft()); let caught: unknown;
        try { await f.facade.update(branch, target.id, { ...draft({ eventType: MessageTriggerEventType.EMPLOYEE_ASSIGNED, offsetType: MessageTriggerOffsetType.IMMEDIATE }), expectedVersion: 1 }); }
        catch (error) { caught = error; }
        const problem = mapHttpProblem(caught, { method: "PUT", acceptsLanguages: () => "ko" } as never, { locals: {} } as never);
        expect(problem).toMatchObject({ status: 400, code: "VALIDATION_FAILED", errors: [{ pointer: "/draft" }] });
        expect(JSON.stringify(problem)).not.toMatch(/cause|stack|Invalid recipient/); expect(f.groups[0]!.version).toBe(1);
        expect(f.repository.updateIfTargetMatchesAndFenceJobs).not.toHaveBeenCalled();
    });

    it("preserves every omitted optional field before validation and still applies explicit replacement values", async () => {
        const f = coreFixture();
        const target = await f.facade.create(branch, draft({ offsetDays: 3, sendTime: "10:30", retryOnFailure: false, isActive: false, targetClientStatus: "pre_booking" }));
        const update = { ...draft({ name: "metadata only" }), expectedVersion: 1 };
        delete update.offsetDays; delete update.sendTime; delete update.retryOnFailure; delete update.isActive; delete update.targetClientStatus;
        await expect(f.facade.update(branch, target.id, update)).resolves.toMatchObject({
            name: "metadata only", version: 2, offsetDays: 3, sendTime: "10:30", retryOnFailure: false, isActive: false, targetClientStatus: "pre_booking",
            rules: [{ offsetDays: 3, sendTime: "10:30", retryOnFailure: false, isActive: false, targetClientStatus: "pre_booking" }],
        });
        await expect(f.facade.update(branch, target.id, { ...draft({ offsetDays: 5, sendTime: "12:15", retryOnFailure: true, isActive: true, targetClientStatus: "active" }), expectedVersion: 2 })).resolves.toMatchObject({
            version: 3, offsetDays: 5, sendTime: "12:15", retryOnFailure: true, isActive: true, targetClientStatus: "active",
        });
    });
});

describe("Phase6 C2 public template input boundary", () => {
    const malformedTemplates: unknown[] = ["NOT_A_TEMPLATE", 7, { toString: "x" }, "toString"];
    it.each(malformedTemplates.flatMap((template) => [undefined, true, false].map((isActive) => ({ template, isActive }))))("rejects malformed update %j before lock-key lookup or mutation", async ({ template, isActive }) => {
        const f = coreFixture(); const target = await f.facade.create(branch, draft());
        const before = structuredClone({ groups: f.groups, rules: f.rules, jobs: f.jobs });
        f.lock.runExclusive.mockClear(); f.templates.getByKeyForBranch.mockClear();
        let caught: unknown;
        try { await f.facade.update(branch, target.id, { ...draft({ isActive, recipientTemplates: { CLIENT: template as MessageTriggerTemplateKey } }), expectedVersion: 1 }); }
        catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(HttpException);
        const problem = mapHttpProblem(caught, { method: "PUT", acceptsLanguages: () => "ko" } as never, { locals: {} } as never);
        expect(problem).toMatchObject({ status: 400, code: "VALIDATION_FAILED", errors: [{ pointer: "/draft" }] });
        expect(JSON.stringify(problem)).not.toMatch(/TypeError|cause|stack|NOT_A_TEMPLATE/);
        expect(structuredClone({ groups: f.groups, rules: f.rules, jobs: f.jobs })).toEqual(before);
        expect(f.repository.updateIfTargetMatchesAndFenceJobs).not.toHaveBeenCalled();
        expect(f.lock.runExclusive).not.toHaveBeenCalled(); expect(f.templates.getByKeyForBranch).not.toHaveBeenCalled();
    });
    it.each(malformedTemplates)("rejects malformed create template %j as coded400 without persistence", async (template) => {
        const f = coreFixture(); let caught: unknown;
        try { await f.facade.create(branch, draft({ recipientTemplates: { CLIENT: template as MessageTriggerTemplateKey } })); }
        catch (error) { caught = error; }
        const problem = mapHttpProblem(caught, { method: "POST", acceptsLanguages: () => "ko" } as never, { locals: {} } as never);
        expect(problem).toMatchObject({ status: 400, code: "VALIDATION_FAILED", errors: [{ pointer: "/draft" }] });
        expect(f.repository.createGroup).not.toHaveBeenCalled(); expect(f.repository.create).not.toHaveBeenCalled();
    });
    it("allows a registered CLIENT template with omitted and explicit active state", async () => {
        const f = coreFixture(); const target = await f.facade.create(branch, draft());
        const update = { ...draft({ name: "valid omitted active" }), expectedVersion: 1 }; delete update.isActive;
        await expect(f.facade.update(branch, target.id, update)).resolves.toMatchObject({ version: 2, isActive: false, recipientTemplates: { CLIENT: "SERVICE_INFO" } });
        await expect(f.facade.update(branch, target.id, { ...draft({ isActive: true }), expectedVersion: 2 })).resolves.toMatchObject({ version: 3, isActive: true, recipientTemplates: { CLIENT: "SERVICE_INFO" } });
    });
});

describe("Phase6 C3 immediate effective-time duplicates", () => {
    it("ignores stored HH:mm for immediate create duplicates while recipes use the same literal instant", async () => {
        const f = coreFixture();
        const immediate = draft({ eventType: MessageTriggerEventType.CLIENT_CREATED, offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0, sendTime: "09:00", recipientTemplates: { CLIENT: MessageTriggerTemplateKey.CLIENT_GREETING } });
        const first = await f.facade.create(branch, immediate);
        const alternative = cloneRule(first.rules[0]!); Object.assign(alternative, { id: "other-immediate-rule", sendTime: "10:00" });
        const client = { id: 1, name: "합성", phone: "01000000001", createdAt: new Date("2026-11-01T00:00:00Z"), startDate: null, endDate: null, serviceEndNoticeSentAt: null };
        const fixedNow = new Date("2026-11-03T12:00:00Z");
        const firstRecipe = buildClientMessageRecipe(first.rules[0]!, client as never, fixedNow);
        const alternativeRecipe = buildClientMessageRecipe(alternative, client as never, fixedNow);
        expect(firstRecipe?.scheduledFor.toISOString()).toBe("2026-11-03T12:00:00.000Z");
        expect(alternativeRecipe?.scheduledFor.toISOString()).toBe("2026-11-03T12:00:00.000Z");
        expect(firstRecipe).toMatchObject({ recipientPhone: "01000000001", recipientType: "CLIENT", templateKey: "CLIENT_GREETING" });
        expect(alternativeRecipe).toMatchObject({ recipientPhone: "01000000001", recipientType: "CLIENT", templateKey: "CLIENT_GREETING" });
        expect(alternativeRecipe?.dedupeKey).not.toBe(firstRecipe?.dedupeKey);
        await expect(f.facade.create(branch, { ...immediate, sendTime: "10:00" })).rejects.toMatchObject({ status: 409 });
        await expect(f.core.createRule(branch, { name: "legacy immediate", eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE, sendTime: "11:00", isActive: false,
            recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING })).rejects.toMatchObject({ status: 409 });
        expect(f.groups).toHaveLength(1); expect(f.rules).toHaveLength(1); expect(f.groups[0]!.version).toBe(1);
    });
    it("refuses a group or legacy update into existing immediate semantics without changing any state", async () => {
        const f = coreFixture();
        const immediate = draft({ eventType: MessageTriggerEventType.CLIENT_CREATED, offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0, sendTime: "09:00", recipientTemplates: { CLIENT: MessageTriggerTemplateKey.CLIENT_GREETING } });
        await f.facade.create(branch, immediate);
        const target = await f.facade.create(branch, draft({ sendTime: "10:00" }));
        const before = structuredClone({ groups: f.groups, rules: f.rules, jobs: f.jobs });
        await expect(f.facade.update(branch, target.id, { ...immediate, sendTime: "10:00", expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
        await expect(f.core.updateRule(branch, target.rules[0]!.id, { eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE, offsetDays: 0, sendTime: "11:00", templateKey: MessageTriggerTemplateKey.CLIENT_GREETING })).rejects.toMatchObject({ status: 409 });
        expect(structuredClone({ groups: f.groups, rules: f.rules, jobs: f.jobs })).toEqual(before);
        expect(f.repository.updateIfTargetMatchesAndFenceJobs).not.toHaveBeenCalled();
    });
    it("retains distinct calendar times and excludes the same group during metadata updates", async () => {
        const f = coreFixture();
        const first = await f.facade.create(branch, draft({ sendTime: "09:00" }));
        const second = await f.facade.create(branch, draft({ sendTime: "10:00" }));
        expect(second).toMatchObject({ version: 1, sendTime: "10:00" });
        await expect(f.facade.update(branch, first.id, { ...draft({ name: "calendar metadata", sendTime: "09:00" }), expectedVersion: 1 })).resolves.toMatchObject({
            version: 2, name: "calendar metadata", sendTime: "09:00", rules: [{ id: first.rules[0]!.id, sendTime: "09:00" }],
        });
        expect(f.groups).toHaveLength(2); expect(f.rules).toHaveLength(2);
        const immediate = draft({ eventType: MessageTriggerEventType.CLIENT_CREATED, offsetType: MessageTriggerOffsetType.IMMEDIATE,
            offsetDays: 0, sendTime: "09:00", recipientTemplates: { CLIENT: MessageTriggerTemplateKey.CLIENT_GREETING } });
        const own = await f.facade.create(branch, immediate);
        await expect(f.facade.update(branch, own.id, { ...immediate, name: "immediate metadata", sendTime: "10:00", expectedVersion: 1 })).resolves.toMatchObject({
            version: 2, name: "immediate metadata", sendTime: "10:00", rules: [{ id: own.rules[0]!.id, sendTime: "10:00" }],
        });
    });
});

describe("SbMessageTriggerRuleRepository generic group primitives", () => {
    it.each(["CLIENT", "PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE", "BOTH_EMPLOYEES"] as const)("persists %s without a CLIENT-only SQL gate and uses only the supplied transaction", async (mode) => {
        const row = new MessageTriggerRuleGroupEntity("legacy-rule:opaque", branch, "group", mode as MessageTriggerRuleGroupEntity["recipientMode"], 4, new Date(), new Date());
        const transaction = {
            message_trigger_rule_group: { create: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            message_trigger_rule: { findMany: jest.fn().mockResolvedValue([]) },
            $queryRaw: jest.fn().mockResolvedValue([{ id: row.id }]),
        };
        const repository = new SbMessageTriggerRuleRepository({} as never);
        expect(await repository.createGroup(branch, row.name, row.recipientMode, transaction as never)).toMatchObject({ recipientMode: mode });
        await repository.lockGroup(branch, row.id, transaction as never); await repository.lockGroupRules(branch, row.id, transaction as never);
        await repository.findGroupRules(branch, row.id, transaction as never, true);
        expect(transaction.message_trigger_rule.findMany).toHaveBeenCalledWith({ where: { branchId: branch, groupId: row.id }, orderBy: { id: "asc" } });
        expect(await repository.updateGroupCAS(branch, row, 4, transaction as never)).toBe(true);
        expect(transaction.message_trigger_rule_group.updateMany).toHaveBeenCalledWith({ where: { id: row.id, branchId: branch, deletedAt: null, version: 4 }, data: { name: "group", recipientMode: mode, version: { increment: 1 } } });
    });
});
