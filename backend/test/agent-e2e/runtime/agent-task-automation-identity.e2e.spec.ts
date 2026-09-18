import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AgentAutomationAuthority, AgentAutomationEffect, AgentAutomationScope } from "../../../domain/entities/agent-automation-consent";
import { agentAutomationEffectDigest, agentAutomationLineageKey, agentAutomationPolicyDigest, agentAutomationRecordDigest,
    agentAutomationScheduleIdentity, resolveAgentAutomationAuthority } from "../../../application/agent/agent-automation-consent";
import { assertApprovedAgentTaskPersistenceDatabaseTarget, createApprovedAgentTaskPersistenceClient } from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const branchId = "b7400000-0000-4000-8000-000000000001";
const clientId = 971200001;
const employeeId = 31201;
const scheduleId = 971200011;
const scheduleInput = {
    id: scheduleId, branchId, clientId, primaryEmployeeId: employeeId, workAddress: "합성 일정 주소",
    startDate: new Date("2030-01-01T00:00:00.000Z"), endDate: new Date("2030-01-10T00:00:00.000Z"),
};

describeAgentE2E("immutable schedule identity for task automation", () => {
    let prisma: PrismaClient;
    async function cleanup() {
        await prisma.employee_schedule.deleteMany({ where: { branchId } });
        await prisma.client.deleteMany({ where: { id: clientId, branchId } });
        await prisma.employee.deleteMany({ where: { id: employeeId, branchId } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
    }
    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await cleanup();
        await prisma.branch.create({ data: { id: branchId, name: "합성 일정 식별 지점", slug: "agent-task-automation-identity-e2e" } });
        await prisma.client.create({ data: { id: clientId, branchId, name: "합성 고객", phone: "01000000121", voucherClient: false } });
        await prisma.employee.create({ data: { id: employeeId, branchId, name: "합성 담당자", phone: "01000000122", workArea: [], grade: "test" } });
        await prisma.employee_schedule.create({ data: scheduleInput });
    });
    afterAll(async () => {
        if (prisma) { await cleanup(); await prisma.$disconnect(); }
    });

    it("generates unique defaults and keeps identity on ordinary edits", async () => {
        const first = await prisma.employee_schedule.findUniqueOrThrow({ where: { id: scheduleId } });
        const second = await prisma.employee_schedule.create({ data: { ...scheduleInput, id: scheduleId + 1 } });
        expect(first.incarnationId).toMatch(/^[a-f0-9-]{36}$/);
        expect(second.incarnationId).not.toBe(first.incarnationId);
        const updated = await prisma.employee_schedule.update({ where: { id: scheduleId }, data: { workAddress: "합성 정정 주소" } });
        expect(updated.incarnationId).toBe(first.incarnationId);
        await prisma.employee_schedule.update({ where: { id: scheduleId }, data: { workAddress: scheduleInput.workAddress } });
    });

    it("rejects identity mutation atomically, including preceding writes in the transaction", async () => {
        const before = await prisma.employee_schedule.findUniqueOrThrow({ where: { id: scheduleId } });
        await expect(prisma.$transaction(async (tx) => {
            await tx.employee_schedule.update({ where: { id: scheduleId }, data: { workAddress: "취소되어야 하는 변경" } });
            await tx.employee_schedule.update({ where: { id: scheduleId }, data: { incarnationId: randomUUID() } });
        })).rejects.toThrow("Schedule incarnation identity is immutable");
        expect(await prisma.employee_schedule.findUniqueOrThrow({ where: { id: scheduleId } })).toEqual(before);
        await expect(prisma.employee_schedule.create({ data: { ...scheduleInput, id: scheduleId + 2, incarnationId: before.incarnationId } }))
            .rejects.toMatchObject({ code: "P2002" });
    });

    it("refuses historical consent after numeric schedule ID reuse with identical business fields", async () => {
        const previous = await prisma.employee_schedule.findUniqueOrThrow({ where: { id: scheduleId } });
        const digest = "a".repeat(64);
        const scope: AgentAutomationScope = { branchId, clientId, clientIdentity: digest, kind: "employee-assignment",
            ruleId: "synthetic-rule", scheduleId, scheduleIdentity: agentAutomationScheduleIdentity(previous.incarnationId), recipientType: "primary-employee" };
        const effects: AgentAutomationEffect[] = [{ kind: scope.kind, ruleId: scope.ruleId, scheduleId, recipientType: scope.recipientType,
            templateKey: "EMPLOYEE_ASSIGNED", change: "create", recipientDigest: digest, sourceDigest: digest, templateDigest: digest,
            policyDigest: digest, recipeDigest: digest }];
        const authority: AgentAutomationAuthority = { version: 1, id: randomUUID(), scope, sequence: 1, previousId: null,
            origin: { kind: "task", userId: randomUUID(), actionId: randomUUID(), taskId: randomUUID(), taskRevision: 1, consentEventId: randomUUID() },
            decision: "allow", noSend: false, effects, scopeEffectDigest: agentAutomationEffectDigest(effects),
            reviewedEffectDigest: agentAutomationEffectDigest(effects), reviewedPolicyDigest: agentAutomationPolicyDigest(effects),
            recordedAt: new Date().toISOString(), recordDigest: "" };
        authority.recordDigest = agentAutomationRecordDigest(authority);
        const query = { records: [authority], scope, effect: effects[0]!, currentScopeEffectDigest: authority.scopeEffectDigest, knownTaskOrigin: true };
        expect(resolveAgentAutomationAuthority(query).status).toBe("allowed");
        await prisma.employee_schedule.delete({ where: { id: scheduleId } });
        const recreated = await prisma.employee_schedule.create({ data: scheduleInput });
        expect(recreated.incarnationId).not.toBe(previous.incarnationId);
        const currentScope = { ...scope, scheduleIdentity: agentAutomationScheduleIdentity(recreated.incarnationId) };
        expect(agentAutomationLineageKey(currentScope)).toBe(agentAutomationLineageKey(scope));
        expect(resolveAgentAutomationAuthority({ ...query, scope: currentScope })).toEqual({ status: "refused", reason: "scope-mismatch" });
    });

    it("has the database-owned default, unique index and enabled immutable trigger", async () => {
        const rows = await prisma.$queryRaw<Array<{ default_expr: string; not_null: boolean; unique_index: boolean; immutable_trigger: boolean }>>`
            SELECT pg_get_expr(d.adbin,d.adrelid) AS default_expr, a.attnotnull AS not_null,
              EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=a.attrelid AND i.indisunique
                AND i.indexrelid='employee_schedule_incarnation_id_key'::regclass) AS unique_index,
              EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=a.attrelid
                AND t.tgname='employee_schedule_incarnation_immutable' AND t.tgenabled='O') AS immutable_trigger
            FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid='employee_schedule'::regclass AND a.attname='incarnation_id'
        `;
        expect(rows).toEqual([{ default_expr: "gen_random_uuid()", not_null: true, unique_index: true, immutable_trigger: true }]);
    });
});
