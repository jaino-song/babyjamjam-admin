import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import * as evaluator from "domain/message-policy-evaluator";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { isSelectedMessageJobExpired } from "application/services/message-trigger-recipes";

const original = new Date("2026-11-03T13:30:00.000Z");
const release = new Date("2026-11-03T23:00:00.000Z");
const now = new Date("2026-11-03T13:40:00.000Z");
function job() {
    return MessageTriggerJobEntity.create({ branchId: "branch-a", ruleId: "rule-a", scheduledFor: original,
        recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.INFO,
        dedupeKey: "quiet-job", payload: { memberId: "", recipientName: "synthetic", recipientPhone: "01000000011", templateVariables: {} } });
}

describe("quiet queue stable expiry", () => {
    // The optional argument deliberately exercises the old implementation too.
    const expired = isSelectedMessageJobExpired;
    it("allows the 22:30 hold at the literal 08:00 release without changing source time", () => {
        const held = job();
        expect(expired(held, 1, release, release)).toBe(false);
        expect(held.scheduledFor.toISOString()).toBe("2026-11-03T13:30:00.000Z");
    });
    it("expires after 09:00, while an ordinary old job still expires at 08:00", () => {
        expect(expired(job(), 1, new Date("2026-11-04T00:00:01.000Z"), release)).toBe(true);
        expect(expired(job(), 1, release)).toBe(true);
    });
});

describe("held policy changes", () => {
    const evaluateHeld = (quiet: ReturnType<typeof defaultMessageAutomationPolicy>["quietHours"]) => {
        return evaluator.evaluateHeldMessageQuietHours(quiet, ["CLIENT"], now, release);
    };
    it("cancels at 22:40 although the old 08:00 due is end exclusive", () => {
        expect(evaluateHeld({ ...defaultMessageAutomationPolicy().quietHours, enabled: true, action: "CANCEL" })).toEqual({ action: "CANCEL", reevaluateAt: null });
    });
    it("moves old 08:00 to 09:00 although now is outside the new 23–09 window", () => {
        expect(evaluateHeld({ ...defaultMessageAutomationPolicy().quietHours, enabled: true, start: "23:00", end: "09:00" })).toEqual({ action: "DEFER", reevaluateAt: new Date("2026-11-04T00:00:00.000Z") });
    });
});

import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { MessageQuietHoursService } from "application/services/message-quiet-hours.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageDuplicateCheckService } from "application/services/message-duplicate-check.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { MANUAL_SMS_TEMPLATE_KEY, isConfigurableSmsTriggerTemplate, isRetiredFixedEventTemplate, findMessageTriggerTemplate, MESSAGE_TRIGGER_TEMPLATE_CATALOG } from "domain/constants/message-trigger-catalog";

// The SQL/Prisma boundary is synthetic; all application controls and repositories execute.
type Row = Record<string, unknown>;
function memoryQueue() {
    const branchId = "88000000-0000-4000-8000-000000000001";
    const tables: Record<string, Row[]> = { message_log: [], message_trigger_job: [], message_trigger_rule: [], system_setting: [],
        client: [{ id: 7, branchId, name: "synthetic", phone: "01000000011", deletedAt: null }], employee: [] };
    let active = false;
    let commitFailure = false;
    let logCasFailure = false;
    let duplicateMatches: Array<{ id: number; sentAt: Date }> = [];
    const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, value]) => {
        if (key === "AND") return (Array.isArray(value) ? value : [value]).every(part => matches(row, part as Row));
        if (key === "OR") return (value as Row[]).some(part => matches(row, part));
        if (key === "NOT") return !(Array.isArray(value) ? value : [value]).some(part => matches(row, part as Row));
        if (value && typeof (value as Date).getTime === "function") return !!row[key] && typeof (row[key] as Date).getTime === "function" && (row[key] as Date).getTime() === (value as Date).getTime();
        if (value && typeof value === "object") {
            const predicate = value as Row;
            const actual = predicate["path"] ? (predicate["path"] as string[]).reduce<unknown>((nested, field) => (nested as Row | null)?.[field], row[key]) : row[key];
            if (predicate["equals"] === Prisma.DbNull) return actual === undefined;
            if ("startsWith" in predicate) return typeof actual === "string" && actual.startsWith(String(predicate["startsWith"]));
            if ("equals" in predicate) return JSON.stringify(actual) === JSON.stringify(predicate["equals"]);
            if ("in" in predicate) return (predicate["in"] as unknown[]).includes(actual);
            if ("notIn" in predicate) return !(predicate["notIn"] as unknown[]).includes(actual);
            if ("not" in predicate) return actual !== predicate["not"];
            if ("some" in predicate && key === "logs") return tables["message_log"]!.some(log => log["triggerJobId"] === row["id"] && matches(log, predicate["some"] as Row));
            if ("lt" in predicate) return Number(actual) < Number(predicate["lt"]);
            return true;
        }
        return value === undefined || row[key] === value;
    });
    const model = (name: string) => ({
        findUnique: jest.fn(async ({ where }: { where: Row }) => structuredClone(tables[name]!.find(row => matches(row, where)) ?? null)),
        findFirst: jest.fn(async ({ where }: { where: Row }) => structuredClone(tables[name]!.find(row => matches(row, where)) ?? null)),
        findMany: jest.fn(async ({ where = {}, include }: { where?: Row; include?: Row } = {}) => tables[name]!.filter(row => matches(row, where)).map(row => {
            const result = structuredClone(row);
            if (include?.["logs"]) result["logs"] = tables["message_log"]!.filter(log => log["triggerJobId"] === row["id"] && matches(log, ((include["logs"] as Row)["where"] ?? {}) as Row));
            return result;
        })),
        create: jest.fn(async ({ data }: { data: Row }) => {
            const row: Row = { id: name === "message_log" ? tables[name]!.length + 1 : randomUUID(),
                createdAt: new Date(Date.now()), updatedAt: new Date(Date.now()), triggerJobId: null, deletedAt: null, groupId: null,
                isActive: false, jobsStale: false, providerCallStartedAt: null, providerAcceptedAt: null, aligoMid: null,
                errorMessage: null, lastAttemptAt: null, nextRetryAt: null, ...structuredClone(data) };
            if (name === "message_log" && tables[name]!.some(existing => existing["providerAcceptanceKey"] === row["providerAcceptanceKey"])) throw new Error("Duplicate acceptance");
            tables[name]!.push(row); return structuredClone(row);
        }),
        updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
            if (name === "message_log" && logCasFailure) return { count: 0 };
            const found = tables[name]!.filter(row => matches(row, where));
            for (const row of found) Object.assign(row, structuredClone(data), { updatedAt: new Date(Date.now()) });
            return { count: found.length };
        }),
        update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const row = tables[name]!.find(row => matches(row, where));
            if (!row) throw new Error("Missing row");
            Object.assign(row, structuredClone(data)); return structuredClone(row);
        }),
        upsert: jest.fn(async ({ where, create }: { where: Row; create: Row }) => {
            const existing = tables[name]!.find(row => matches(row, where));
            if (existing) return structuredClone(existing);
            const row = { deletedAt: null, jobsStale: false, ...create }; tables[name]!.push(row); return structuredClone(row);
        }),
    });
    const db = {
        message_log: model("message_log"), message_trigger_job: model("message_trigger_job"), message_trigger_rule: model("message_trigger_rule"),
        client: model("client"), employee: model("employee"), system_setting: model("system_setting"),
        $executeRaw: jest.fn(async () => 1),
        $transaction: async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
            expect(active).toBe(false); active = true;
            const snapshot = structuredClone(tables);
            try { const result = await work(db as never); if (commitFailure) throw new Error("late commit failure"); return result; }
            catch (error) { for (const key of Object.keys(tables)) tables[key] = snapshot[key]!; throw error; }
            finally { active = false; }
        },
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            if (sql.sql.includes("SELECT ml.id")) return duplicateMatches;
            if (sql.sql.includes("WITH RECURSIVE ancestors")) return tables["message_log"]!.map(log => ({ id: log["id"] }));
            if (sql.sql.includes('FROM "user"')) return [...tables["client"]!.map(client => ({ phone: client["phone"], group_name: "CLIENT" })), ...tables["employee"]!.map(employee => ({ phone: employee["phone"], group_name: "CAREGIVER" }))];
            const row = tables["message_trigger_job"]!.find(job => sql.values.includes(job["id"] as string));
            if (!row) return [];
            if (sql.sql.includes("SET status = 'processing'")) {
                if (row["status"] !== "pending") return [];
                Object.assign(row, { status: "processing", claimToken: randomUUID(), processingDeadlineAt: sql.values.find(value => value && typeof (value as Date).getTime === "function"), updatedAt: new Date(Date.now()) });
                return [{ id: row["id"], claim_token: row["claimToken"] }];
            }
            if (sql.sql.includes("SET status = 'dispatching'")) {
                if (row["status"] !== "processing" || !sql.values.includes(row["claimToken"] as string)) return [];
                row["status"] = "dispatching"; return [{ id: row["id"] }];
            }
            return [{ ...row, claim_token: row["claimToken"], branch_id: row["branchId"], rule_id: row["ruleId"], client_id: row["clientId"],
                employee_schedule_id: row["employeeScheduleId"], recipient_type: row["recipientType"], template_key: row["templateKey"] }];
        }),
    };
    const configuration = defaultMessageAutomationPolicy();
    configuration.quietHours.enabled = true;
    const key = `branch:${branchId}:message_automation:policy`;
    tables["system_setting"]!.push({ key, value: JSON.stringify(configuration) });
    const jobs = new SbMessageTriggerJobRepository(db as never);
    const logs = new SbMessageLogRepository(db as never);
    const lock = new MessageAutomationBranchLockService(db as never);
    const get = { execute: async (settingKey: string) => tables["system_setting"]!.find(row => row["key"] === settingKey)?.["value"] ?? null };
    const update = { executeIfVersion: async (settingKey: string, value: string, expected: string, versionOf: (raw: string | null) => string) => {
        const row = tables["system_setting"]!.find(item => item["key"] === settingKey)!;
        if (versionOf(row["value"] as string) !== expected) return null;
        row["value"] = value; return { value };
    } };
    const settings = new SystemSettingService(get as never, update as never, undefined, undefined, undefined, jobs, logs, lock);
    const quiet = new MessageQuietHoursService(settings, logs, lock);
    const duplicates = new MessageDuplicateCheckService(logs, { getMessageSettingsPolicyEnabled: async () => false } as never, get as never);
    const approval = { ensureApproved: async () => {}, getApprovedBranchIds: async () => new Set([branchId]) };
    const templates = { findByKey: jest.fn(() => { throw new Error("Automatic renderer must not run"); }) };
    const aligo = { sendSms: jest.fn(async (request: Row) => {
        expect(active).toBe(false);
        return { request, response: { result_code: 1, message: "accepted", msg_id: 91, success_cnt: 1, error_cnt: 0 } };
    }) };
    const sender = { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) };
    const gate = new AgentAutomationDeliveryGateService(db as never, lock, {} as never);
    const sms = new SmsTriggerDeliveryService(aligo as never, templates as never, logs, new SmsProviderAcceptanceService(logs), undefined, gate,
        undefined, settings, undefined, quiet, jobs, sender as never);
    const retry = new SmsRetryService(logs, aligo as never, approval as never, new SmsProviderAcceptanceService(logs), undefined, undefined, sms, jobs, undefined, settings, quiet, sender as never);
    const core = new MessageTriggerService(db as never, new MessageTriggerDeliveryService(sms), approval as never, {} as never, jobs, logs,
        templates as never, {} as never, settings, undefined, undefined, lock);
    const controller = new MessageDeliveryController(aligo as never, approval as never, db as never, duplicates, quiet, jobs, sender as never);
    const send = (extra = {}) => controller.sendSms({ branchId }, { receiver: "01000000011", message: "  synthetic {{literal}}\n", idempotencyKey: "body-key", ...extra }, "ignored-header");
    return { branchId, db, tables, jobs, logs, settings, lock, core, sms, retry, controller, configuration, send, aligo, templates,
        newDuplicates: () => { duplicateMatches = [{ id: 999, sentAt: new Date(Date.now()) }]; },
        configure: (draft: typeof configuration) => { tables["system_setting"]![0]!["value"] = JSON.stringify(draft); },
        commitFailure: () => { commitFailure = true; }, logCasFailure: () => { logCasFailure = true; } };
}

describe("private manual queue through actual controls", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(original.getTime()));
    afterEach(() => jest.restoreAllMocks());
    it("keeps MANUAL_SMS private and preserves public and unknown catalog lookups", () => {
        expect(Object.values(MessageTriggerTemplateKey)).not.toContain(MANUAL_SMS_TEMPLATE_KEY);
        expect(isConfigurableSmsTriggerTemplate(MANUAL_SMS_TEMPLATE_KEY)).toBe(false);
        expect(isRetiredFixedEventTemplate(MANUAL_SMS_TEMPLATE_KEY)).toBe(false);
        expect(findMessageTriggerTemplate(MANUAL_SMS_TEMPLATE_KEY)).toBeUndefined();
        expect(findMessageTriggerTemplate("unknown")).toBeUndefined();
        expect(findMessageTriggerTemplate(MessageTriggerTemplateKey.INFO)).toBe(MESSAGE_TRIGGER_TEMPLATE_CATALOG.INFO);
    });
    it("enqueues one ledger/job, replays the body key across OFF, and reaches the inline fake provider once at 08:00", async () => {
        const f = memoryQueue();
        const result = await f.send();
        expect(result).toMatchObject({ outcome: "deferred", items: [{ status: "deferred", scheduledAt: "2026-11-03T23:00:00.000Z" }] });
        expect(result).not.toHaveProperty("result");
        const source = structuredClone(f.tables["message_trigger_job"]![0]!);
        f.configuration.quietHours.enabled = false; f.configure(f.configuration);
        expect(await f.send()).toEqual(result);
        expect(f.tables["message_log"]).toHaveLength(1); expect(f.tables["message_trigger_job"]).toHaveLength(1);
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = source["id"] as string;
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "sent", cancelReason: null });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(f.aligo.sendSms).toHaveBeenCalledWith(expect.objectContaining({ message: "  synthetic {{literal}}\n", receiver: "01000000011" }));
        expect(f.aligo.sendSms.mock.calls[0]![0]).not.toHaveProperty("scheduledDate");
        expect(f.templates.findByKey).not.toHaveBeenCalled();
        expect(f.tables["message_log"]).toHaveLength(1); expect(f.tables["message_log"]![0]).toMatchObject({ status: "sent", attempts: 1 });
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ scheduledFor: source["scheduledFor"], dedupeKey: source["dedupeKey"], templateKey: "MANUAL_SMS", status: "sent" });
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it("rolls back every initial job/log write if commit fails", async () => {
        const f = memoryQueue(); f.commitFailure();
        await expect(f.send()).rejects.toThrow("late commit failure");
        expect(f.tables["message_log"]).toHaveLength(0); expect(f.tables["message_trigger_job"]).toHaveLength(0);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each([false, true])("preserves the employee manual hold through orphan cleanup and rechecks changed identity=%s at release", async changed => {
        const f = memoryQueue();
        f.tables["employee"]!.push({ id: 8, branchId: f.branchId, name: "synthetic employee", phone: "01000000033", deletedAt: null });
        await f.send({ employeeId: 8, receiver: "01000000033" });
        const source = structuredClone(f.tables["message_trigger_job"]![0]!);
        expect(source).toMatchObject({ clientId: null, employeeScheduleId: null, status: "pending", attempts: 0,
            ruleId: `system:manual-sms:${f.branchId}`, nextAttemptAt: release, payload: { employeeId: 8, origin: "ADMIN_DIRECT" } });
        const controls = [
            { id: "legacy-orphan", ruleId: "ordinary-rule" },
            { id: "agent-orphan", ruleId: "agent-sms:synthetic" },
            { id: "other-branch-orphan", ruleId: "ordinary-rule", branchId: "another-branch" },
            { id: "terminal-orphan", ruleId: "ordinary-rule", status: "sent" },
            { id: "related-client", ruleId: "ordinary-rule", clientId: 7 },
            { id: "related-schedule", ruleId: "ordinary-rule", employeeScheduleId: "schedule-1" },
        ].map(control => ({ ...structuredClone(source), ...control }));
        f.tables["message_trigger_job"]!.push(...controls);
        expect(await f.jobs.cancelOrphanedPending("Related client or schedule deleted", f.branchId)).toBe(1);
        expect(f.tables["message_trigger_job"]![0]).toEqual(source);
        expect(controls[0]).toMatchObject({ status: "canceled", cancelReason: "Related client or schedule deleted" });
        for (const control of controls.slice(1)) expect(control["status"]).toBe(control["id"] === "terminal-orphan" ? "sent" : "pending");
        if (changed) f.tables["employee"]![0]!["phone"] = "01000000044";
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await f.core.dispatchPendingJobNow(source["id"] as string, { expectedBranchId: f.branchId });
        await f.core.dispatchPendingJobNow(source["id"] as string, { expectedBranchId: f.branchId });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(changed ? 0 : 1);
        if (!changed) {
            expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "sent", scheduledFor: source["scheduledFor"],
                dedupeKey: source["dedupeKey"], payload: source["payload"] });
            expect(f.tables["message_log"]).toHaveLength(1);
            expect(f.tables["message_log"]![0]).toMatchObject({ triggerJobId: source["id"], status: "sent", attempts: 1 });
        }
        expect(f.templates.findByKey).not.toHaveBeenCalled();
    });
    it("keeps the original acceptance and rejects changed content with the same body key", async () => {
        const f = memoryQueue(); await f.send();
        await expect(f.send({ message: "changed" })).rejects.toMatchObject({ status: 409 });
        expect(f.tables["message_log"]).toHaveLength(1); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["origin", "branch", "log", "identity", "claim", "key", "fingerprint", "title"])("refuses changed %s before any inline provider call", async kind => {
        const f = memoryQueue(); await f.send();
        const row = f.tables["message_trigger_job"]![0]!;
        if (kind === "origin") (row["payload"] as Row)["origin"] = "AUTOMATIC";
        if (kind === "branch") row["ruleId"] = "system:manual-sms:another-branch";
        if (kind === "log") (row["payload"] as Row)["existingMessageLogId"] = 999;
        if (kind === "identity") f.tables["client"]![0]!["phone"] = "01000000022";
        if (kind === "claim") row["status"] = "dispatching";
        if (kind === "key") f.tables["message_log"]![0]!["providerAcceptanceKey"] = "unrelated-key";
        if (kind === "fingerprint") f.tables["message_log"]![0]!["providerAcceptanceFingerprint"] = "unrelated-fingerprint";
        if (kind === "title") ((row["payload"] as Row)["templateVariables"] as Row)["title"] = "changed title";
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await f.core.dispatchPendingJobNow(row["id"] as string, { expectedBranchId: f.branchId }).catch(() => undefined);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["CANCEL", "DEFER", "OFF", "removed"])("preview and actual policy save reconcile literal %s without advancing the old release", async mode => {
        const f = memoryQueue(); await f.send();
        jest.mocked(Date.now).mockReturnValue(now.getTime());
        const current = await f.settings.getMessageAutomationPolicyConfig(f.branchId);
        const draft = structuredClone(f.configuration);
        if (mode === "CANCEL") draft.quietHours.action = "CANCEL";
        if (mode === "DEFER") Object.assign(draft.quietHours, { start: "23:00", end: "09:00" });
        if (mode === "OFF") draft.quietHours.enabled = false;
        if (mode === "removed") draft.quietHours.recipientGroups = ["STAFF"];
        const before = structuredClone(f.tables);
        const preview = await f.settings.previewMessageAutomationPolicyConfig(f.branchId, current.version, draft, now);
        expect(f.tables).toEqual(before);
        expect(preview).toMatchObject({ canceledCount: mode === "CANCEL" ? 1 : 0, deferredCount: mode === "DEFER" ? 1 : 0 });
        await f.settings.setMessageAutomationPolicyConfig(f.branchId, current.version, draft);
        expect(f.tables["message_trigger_job"]![0]).toMatchObject(mode === "CANCEL" ? { status: "canceled", nextAttemptAt: null }
            : { status: "pending", nextAttemptAt: new Date(mode === "DEFER" ? "2026-11-04T00:00:00.000Z" : "2026-11-03T23:00:00.000Z") });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("rolls back policy and job when the linked log CAS loses", async () => {
        const f = memoryQueue(); await f.send();
        const current = await f.settings.getMessageAutomationPolicyConfig(f.branchId);
        const before = structuredClone(f.tables);
        f.logCasFailure();
        const draft = structuredClone(f.configuration); draft.quietHours.action = "CANCEL";
        await expect(f.settings.setMessageAutomationPolicyConfig(f.branchId, current.version, draft)).rejects.toMatchObject({ status: 503 });
        expect(f.tables).toEqual(before);
    });
});


describe("quiet queue release guards", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(original.getTime()));
    afterEach(() => jest.restoreAllMocks());
    it("holds before 08:00 and expires strictly after the literal 09:00 deadline", async () => {
        const f = memoryQueue(); f.configuration.pastExpiryHours = 1; f.configure(f.configuration); await f.send();
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        expect(f.tables["message_trigger_job"]![0]!["status"]).toBe("pending");
        jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-04T00:00:01.000Z"));
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", cancelReason: "expired_after_quiet" });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["missing", "invalid", "unrelated"])("refuses %s held provenance at release", async kind => {
        const f = memoryQueue(); await f.send();
        const row = f.tables["message_log"]![0]!;
        if (kind === "missing") row["variables"] = {};
        if (kind === "invalid") (row["variables"] as Row)["quietHoursReleaseAt"] = "not-a-time";
        if (kind === "unrelated") (row["variables"] as Row)["quietHoursOriginalScheduledFor"] = "2026-11-03T12:00:00.000Z";
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await expect(f.core.dispatchPendingJobNow(f.tables["message_trigger_job"]![0]!["id"] as string, { expectedBranchId: f.branchId })).rejects.toThrow();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("atomically cancels the manual job and its sole acceptance log", async () => {
        const f = memoryQueue(); await f.send(); const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        expect(await f.jobs.cancelPendingByUser(id, f.branchId, "user canceled")).toBe(true);
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", claimToken: null, processingDeadlineAt: null });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", nextRetryAt: null, providerCallStartedAt: null });
        expect(await f.send()).toMatchObject({ outcome: "canceled" });
    });
    it.each(["token", "deadline", "identity", "attempted", "provider-started"])("does not rewind a held acceptance after %s changes", async kind => {
        const f = memoryQueue(); await f.send();
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        const token = await f.lock.runExclusive(f.branchId, tx => f.jobs.claimPendingWithRuleFence(id, f.branchId, tx, new Date("2026-11-03T23:20:00.000Z")));
        expect(token).toEqual(expect.any(String));
        const claimed = (await f.jobs.findByIdInBranch(f.branchId, id))!;
        const log = f.tables["message_log"]![0]!;
        const current = f.tables["message_trigger_job"]![0]!;
        if (kind === "token") current["claimToken"] = randomUUID();
        if (kind === "deadline") current["processingDeadlineAt"] = new Date("2026-11-03T23:21:00.000Z");
        if (kind === "identity") current["clientId"] = 999;
        if (kind === "attempted") current["attempts"] = 1;
        if (kind === "provider-started") Object.assign(log, { providerAcceptanceState: "started", providerCallStartedAt: release });
        const before = structuredClone(f.tables);
        await expect(f.lock.runExclusive(f.branchId, tx => f.jobs.transitionQuietHold(claimed, log["id"] as number,
            log["providerAcceptanceKey"] as string, log["providerAcceptanceFingerprint"] as string,
            { action: "DEFER", reevaluateAt: new Date("2026-11-04T00:00:00.000Z") }, "current-policy", tx))).rejects.toThrow();
        expect(f.tables).toEqual(before);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("never retries a transient provider rejection from the reserved holder automatically", async () => {
        const f = memoryQueue(); await f.send();
        f.aligo.sendSms.mockImplementationOnce(async request => ({ request, response: { result_code: -1, message: "transient", msg_id: 0, success_cnt: 0, error_cnt: 1 } }));
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await f.core.dispatchPendingJobNow(f.tables["message_trigger_job"]![0]!["id"] as string, { expectedBranchId: f.branchId });
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "failed" });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", attempts: 1, nextRetryAt: null });
        const source = (await f.logs.findByIdInBranch(f.branchId, 1))!;
        await f.retry.retry(source, "automatic");
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1); expect(f.tables["message_log"]).toHaveLength(1);
    });
    it("a manual history retry waits without an attempt, then resumes the same prepared log once", async () => {
        const f = memoryQueue(); await f.send();
        f.aligo.sendSms.mockImplementationOnce(async request => ({ request, response: { result_code: -1, message: "transient", msg_id: 0, success_cnt: 0, error_cnt: 1 } }));
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await f.core.dispatchPendingJobNow(f.tables["message_trigger_job"]![0]!["id"] as string, { expectedBranchId: f.branchId });
        jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-04T13:30:00.000Z"));
        const source = (await f.logs.findByIdInBranch(f.branchId, 1))!;
        const held = await f.retry.retry(source, "manual");
        expect(held).toMatchObject({ id: 2, attempts: 1, providerAcceptanceState: "prepared", providerCallStartedAt: null, nextRetryAt: new Date("2026-11-04T23:00:00.000Z") });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-04T23:00:00.000Z"));
        const resumed = await f.retry.retry(held!, "automatic");
        expect(resumed).toMatchObject({ id: 2, status: "sent", attempts: 2 });
        expect(f.tables["message_log"]).toHaveLength(2); expect(f.aligo.sendSms).toHaveBeenCalledTimes(2);
    });
});

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../integrity/helpers/real-db";
import { createBranch, createClient } from "../integrity/helpers/factories";
import { RowTracker } from "../integrity/helpers/tracker";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";

// Main runs this guard with its existing PostgreSQL runner. The worker never opens a DB.
describeReal("quiet queue SQL selection, claim, and policy reconciliation", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    const branches: string[] = [];
    const policyKeys: string[] = [];
    beforeAll(async () => { assertThrowawayTarget(); handle = await createIntegrityPrisma(); tracker = new RowTracker(); });
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(original.getTime()));
    afterEach(async () => {
        jest.restoreAllMocks();
        for (const branchId of branches) {
            for (const row of await handle.raw.message_log.findMany({ where: { branchId }, select: { id: true } })) tracker.track("message_log", row.id);
            for (const row of await handle.raw.message_trigger_job.findMany({ where: { branchId }, select: { id: true } })) tracker.track("message_trigger_job", row.id);
            for (const row of await handle.raw.message_trigger_rule.findMany({ where: { branchId }, select: { id: true } })) tracker.track("message_trigger_rule", row.id);
        }
    });
    afterAll(async () => {
        if (!handle) return;
        await handle.raw.system_setting.deleteMany({ where: { key: { in: policyKeys } } });
        await tracker.cleanup(handle.raw); await closeIntegrityPrisma(handle);
    });
    async function pgSlice() {
        const branch = await createBranch(handle.raw, tracker); branches.push(branch.id);
        const client = await createClient(handle.raw, tracker, { branchId: branch.id, name: "synthetic quiet", phone: "01000000011", phoneNormalized: "01000000011" });
        const configuration = defaultMessageAutomationPolicy(); configuration.pastExpiryHours = 1; configuration.quietHours.enabled = true;
        const key = `branch:${branch.id}:message_automation:policy`;
        await handle.raw.system_setting.create({ data: { key, value: JSON.stringify(configuration) } }); policyKeys.push(key);
        const jobs = new SbMessageTriggerJobRepository(handle.service);
        const logs = new SbMessageLogRepository(handle.service);
        const lock = new MessageAutomationBranchLockService(handle.service);
        const settingsRepo = new SbSystemSettingRepository(handle.service);
        const settings = new SystemSettingService(new GetSettingUsecase(settingsRepo), new UpdateSettingUsecase(settingsRepo), undefined, undefined, undefined, jobs, logs, lock);
        const quiet = new MessageQuietHoursService(settings, logs, lock);
        const duplicates = new MessageDuplicateCheckService(logs, { getMessageSettingsPolicyEnabled: async () => false } as never, {} as never);
        const sender = { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) };
        const approval = { ensureApproved: async () => {}, getApprovedBranchIds: async () => new Set([branch.id]) };
        const aligo = { sendSms: jest.fn(async (request: Record<string, unknown>) => {
            // A separate connection can read the committed provider-start marker during transport.
            expect(await handle.raw.message_log.count({ where: { branchId: branch.id, providerAcceptanceState: "started" } })).toBe(1);
            return { request, response: { result_code: 1, message: "accepted", msg_id: 91, success_cnt: 1, error_cnt: 0 } };
        }) };
        const gate = new AgentAutomationDeliveryGateService(handle.service, lock, {} as never);
        const sms = new SmsTriggerDeliveryService(aligo as never, {} as never, logs, new SmsProviderAcceptanceService(logs), undefined, gate,
            undefined, settings, undefined, quiet, jobs, sender as never);
        const core = new MessageTriggerService(handle.service, new MessageTriggerDeliveryService(sms), approval as never, {} as never, jobs, logs,
            {} as never, {} as never, settings, undefined, undefined, lock);
        const controller = new MessageDeliveryController(aligo as never, approval as never, handle.service, duplicates, quiet, jobs, sender as never);
        const result = await controller.sendSms({ branchId: branch.id }, { clientId: client.id, receiver: "01000000011", message: "synthetic PG", idempotencyKey: "pg-queue" });
        if (!("items" in result)) throw new Error("Expected internal queue response");
        const item = result.items[0]!;
        return { branchId: branch.id, configuration, jobs, logs, settings, lock, core, aligo, jobId: item.jobId, logId: item.messageLogId };
    }
    it("SQL uses the stable 08:00 anchor, initial retry-OFF selection bypasses cadence, and the real Core sends once", async () => {
        const f = await pgSlice(); const source = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        expect(source).toMatchObject({ status: "pending", attempts: 0, claimToken: null, nextAttemptAt: release });
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const selected = await f.jobs.consumeDispatchSlotsAndFindDueJobs([{ branchId: f.branchId, automaticEnabled: true, retryEnabled: true, intervalMinutes: 1440, pastExpiryHours: 1 }], release);
        expect(selected).toHaveLength(1); expect(selected[0]!.dispatchSelection).toMatchObject({ expired: false, anchor: release });
        const runtimeKey = `branch:${f.branchId}:message_automation:last_dispatch_at`; policyKeys.push(runtimeKey);
        expect(await f.jobs.consumeDispatchSlotsAndFindDueJobs([{ branchId: f.branchId, automaticEnabled: true, retryEnabled: false, intervalMinutes: 1440, pastExpiryHours: 1 }], release)).toHaveLength(0);
        expect((await f.jobs.findDueQuietQueueJobs(release)).some(job => job.id === f.jobId)).toBe(true);
        expect((await f.jobs.findQuietHeldJobs(f.branchId))[0]!.hold.releaseAt).toEqual(release);
        await f.core.dispatchPendingJobNow(f.jobId, { expectedBranchId: f.branchId });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(await handle.raw.message_log.count({ where: { branchId: f.branchId } })).toBe(1);
        expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } })).toMatchObject({ scheduledFor: source.scheduledFor, dedupeKey: source.dedupeKey, status: "sent" });
    });
    it("the fresh claim-time helper cancels after 09:00 with an atomic terminal log and no provider", async () => {
        const f = await pgSlice(); jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-04T00:00:01.000Z"));
        await f.core.dispatchPendingJobNow(f.jobId, { expectedBranchId: f.branchId });
        expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } })).toMatchObject({ status: "canceled", cancelReason: "expired_after_quiet", claimToken: null });
        expect(await handle.raw.message_log.findUniqueOrThrow({ where: { id: f.logId } })).toMatchObject({ status: "failed", nextRetryAt: null, providerCallStartedAt: null });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["CANCEL", "DEFER", "OFF", "removed"])("real policy writer agrees with preview for literal %s", async mode => {
        const f = await pgSlice(); jest.mocked(Date.now).mockReturnValue(now.getTime());
        const current = await f.settings.getMessageAutomationPolicyConfig(f.branchId);
        const draft = structuredClone(f.configuration);
        if (mode === "CANCEL") draft.quietHours.action = "CANCEL";
        if (mode === "DEFER") Object.assign(draft.quietHours, { start: "23:00", end: "09:00" });
        if (mode === "OFF") draft.quietHours.enabled = false;
        if (mode === "removed") draft.quietHours.recipientGroups = ["STAFF"];
        const before = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        const preview = await f.settings.previewMessageAutomationPolicyConfig(f.branchId, current.version, draft, now);
        expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } })).toEqual(before);
        expect(preview).toMatchObject({ canceledCount: mode === "CANCEL" ? 1 : 0, deferredCount: mode === "DEFER" ? 1 : 0 });
        await f.settings.setMessageAutomationPolicyConfig(f.branchId, current.version, draft);
        expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } })).toMatchObject({ payload: before.payload, scheduledFor: before.scheduledFor,
            status: mode === "CANCEL" ? "canceled" : "pending", nextAttemptAt: mode === "CANCEL" ? null : new Date(mode === "DEFER" ? "2026-11-04T00:00:00.000Z" : "2026-11-03T23:00:00.000Z") });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("a late SQL transaction failure rolls both hold writes back", async () => {
        const f = await pgSlice(); const held = (await f.jobs.findQuietHeldJobs(f.branchId))[0]!;
        const before = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        await expect(f.lock.runExclusive(f.branchId, async tx => {
            await f.jobs.transitionQuietHold(held.job, held.logId, held.acceptanceKey, held.fingerprint, { action: "CANCEL", reevaluateAt: null }, held.hold.policyRevision, tx);
            throw new Error("late SQL rollback");
        })).rejects.toThrow("late SQL rollback");
        expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } })).toEqual(before);
        expect(await handle.raw.message_log.findUniqueOrThrow({ where: { id: f.logId } })).toMatchObject({ status: "pending", providerAcceptanceState: "prepared" });
    });
    it("competing claims have one winner, and a restarted Core reuses the existing acceptance", async () => {
        const f = await pgSlice(); jest.mocked(Date.now).mockReturnValue(release.getTime());
        const second = await Promise.all([f.jobs.claimPendingWithRuleFence(f.jobId, f.branchId), f.jobs.claimPendingWithRuleFence(f.jobId, f.branchId)]);
        expect(second.filter(Boolean)).toHaveLength(1);
        const current = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        // Simulate a restart before provider authorization, with the actual reclaim CAS.
        const job = (await f.jobs.findStaleProcessingSystemScope(new Date(current.updatedAt.getTime() + 86_400_000))).find(candidate => candidate.id === f.jobId)!;
        const snapshot = { status: job.status, claimToken: job.claimToken, updatedAt: job.updatedAt, processingDeadlineAt: job.processingDeadlineAt };
        job.status = "pending"; job.nextAttemptAt = release;
        expect(await f.jobs.reclaimWithClaimFence(job, snapshot)).toBe(true);
        await f.core.dispatchPendingJobNow(f.jobId, { expectedBranchId: f.branchId });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(await handle.raw.message_log.count({ where: { branchId: f.branchId, triggerJobId: current.id } })).toBe(1);
    });
});


describe("manual batch and fresh duplicate release", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(original.getTime()));
    afterEach(() => jest.restoreAllMocks());
    it.each(["DEFER", "CANCEL"] as const)("splits the complete mixed %s batch into deterministic ordinal jobs in one transaction", async action => {
        const f = memoryQueue(); f.configuration.quietHours.recipientGroups = ["CLIENT"]; f.configuration.quietHours.action = action; f.configure(f.configuration);
        f.tables["employee"]!.push({ id: 11, branchId: f.branchId, name: "synthetic employee", phone: "01000000022", deletedAt: null });
        const result = await f.send({ receiver: "010-0000-0022,01000000011,01000000022" });
        expect(result).toMatchObject({ outcome: "mixed", items: [
            { recipientPhone: "01000000011", status: action === "DEFER" ? "deferred" : "canceled" },
            { recipientPhone: "01000000022", status: "queued", scheduledAt: "2026-11-03T13:30:00.000Z" },
        ] });
        expect(f.tables["message_trigger_job"]).toHaveLength(2); expect(f.tables["message_log"]).toHaveLength(2);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("validates all identities before writing any ordinal", async () => {
        const f = memoryQueue();
        await expect(f.send({ receiver: "01000000011,01000000099" })).rejects.toMatchObject({ status: 404 });
        expect(f.tables["message_log"]).toHaveLength(0); expect(f.tables["message_trigger_job"]).toHaveLength(0);
    });
    it("cancels a new duplicate at release and requires a new request for another confirmation", async () => {
        const f = memoryQueue(); await f.send(); f.newDuplicates();
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await f.core.dispatchPendingJobNow(f.tables["message_trigger_job"]![0]!["id"] as string, { expectedBranchId: f.branchId });
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", cancelReason: "duplicate_at_release" });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", nextRetryAt: null });
        expect(await f.send()).toMatchObject({ outcome: "canceled", items: [{ reason: "duplicate_at_release" }] });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
});

import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType } from "domain/constants/message-trigger-catalog";
import { buildClientMessageRecipe, type ClientTriggerSource } from "application/services/message-trigger-recipes";
import { describeClientMessageEffect } from "application/services/client-message-effect-recipe";
import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { agentAutomationTaskCommitReference } from "application/agent/agent-automation-record-store.service";
import { agentAutomationCoverageRecordDigest, agentAutomationCoverageScope } from "application/agent/agent-automation-coverage";
import { agentAutomationRecordDigest, agentAutomationEffectDigest, agentAutomationPolicyDigest } from "application/agent/agent-automation-consent";
import { agentAutomationSourcePayload } from "application/services/agent-automation-job-binding";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import type { AgentAutomationAuthority, AgentAutomationCoverage, AgentAutomationScope } from "domain/entities/agent-automation-consent";

describe("sealed automatic source across quiet release", () => {
    beforeEach(() => jest.useFakeTimers({ now: original }));
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
    it.each([false, true])("preserves the real authority seal and rechecks changed source=%s at 08:00", async changed => {
        const f = memoryQueue(); f.configuration.pastExpiryHours = 1; f.configure(f.configuration);
        const client: ClientTriggerSource = { id: 7, name: "synthetic", phone: "01000000011", type: null, createdAt: original,
            startDate: null, endDate: null, serviceEndNoticeSentAt: null };
        Object.assign(f.tables["client"]![0]!, { createdAt: original, smsAutomationEnabled: true });
        const rule = MessageTriggerRuleEntity.reconstitute("88000000-0000-4000-8000-000000000099", f.branchId, "synthetic", true,
            MessageTriggerEventType.CLIENT_CREATED, MessageTriggerOffsetType.IMMEDIATE, 0, MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.INFO, original, original);
        f.tables["message_trigger_rule"]!.push({ ...rule, deletedAt: null });
        const sourceSettings = { status: "available" as const, rules: [rule], defaultsPresent: true, dispatchEnabled: true,
            senderApproved: true, senderApprovedAt: null, pastTriggerEnabled: false, pastTriggerConfig: { sendIntervalMinutes: 1, ruleOrder: [] } };
        const sourceReader = { readClientAutomationSettings: async () => sourceSettings, readClientAutomationSource: async () => client };
        const sender = { read: () => ({ availability: "available" as const, identityDigest: "a".repeat(64) }) };
        const templates = { getByKeyForBranch: async () => ({ content: "authority {{name}}" }) };
        const ruleRepository = { findByIdIncludingGlobal: async () => rule };
        const preliminary = new SmsTriggerDeliveryService({} as never, templates as never, f.logs, undefined, undefined, undefined, ruleRepository as never, f.settings);
        const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: client.id, createdAt: original.toISOString() });
        const described = await describeClientMessageEffect({ branchId: f.branchId, subject: { kind: "client", clientId: 7, clientIdentity }, rule, client,
            change: "create", now: original, policy: { dispatchEnabled: true, senderApproved: true, senderIdentityDigest: "a".repeat(64), senderApprovedAt: null,
                pastTriggerEnabled: false, pastTriggerConfig: { sendIntervalMinutes: 1, ruleOrder: [] } }, delivery: preliminary });
        if (described.status !== "effect") throw new Error("Expected a real current source effect");
        const scope: AgentAutomationScope = { branchId: f.branchId, clientId: 7, clientIdentity, kind: "client-rule", ruleId: rule.id,
            scheduleId: null, scheduleIdentity: null, recipientType: "client" };
        const origin = { kind: "task" as const, userId: randomUUID(), actionId: randomUUID(), taskId: randomUUID(), taskRevision: 1, consentEventId: randomUUID() };
        const authority: AgentAutomationAuthority = { version: 1, id: randomUUID(), scope, sequence: 1, previousId: null, origin,
            decision: "allow", noSend: false, effects: [described.effect], scopeEffectDigest: agentAutomationEffectDigest([described.effect]),
            reviewedEffectDigest: agentAutomationEffectDigest([described.effect]), reviewedPolicyDigest: agentAutomationPolicyDigest([described.effect]),
            recordedAt: original.toISOString(), recordDigest: "" };
        authority.recordDigest = agentAutomationRecordDigest(authority);
        const coverage: AgentAutomationCoverage = { kind: "coverage", version: 1, id: randomUUID(), scope: agentAutomationCoverageScope(scope), sequence: 1,
            previousId: null, origin, mutationDigest: agentBindingHash("synthetic committed mutation"), grandfatheredScopes: [], recordedAt: original.toISOString(), recordDigest: "" };
        coverage.recordDigest = agentAutomationCoverageRecordDigest(coverage);
        const batch = { authorities: [authority], coverages: [coverage] };
        // Only committed-record persistence is synthetic; authority/effect/seal validation executes.
        const records = { readLineageEvidence: async () => ({ batch, creationSubjects: [] }), verifyTaskCommitReference: async () => true };
        const sourceAuthority = new AgentAutomationJobAuthorityService(new AgentAutomationAuthorityService(records as never), sourceReader as never, sender as never);
        const gate = new AgentAutomationDeliveryGateService(f.db as never, f.lock, sourceAuthority);
        const quiet = new MessageQuietHoursService(f.settings, f.logs, f.lock);
        const sms = new SmsTriggerDeliveryService(f.aligo as never, templates as never, f.logs, new SmsProviderAcceptanceService(f.logs), undefined, gate,
            ruleRepository as never, f.settings, undefined, quiet, f.jobs, sender as never);
        const recipe = buildClientMessageRecipe(rule, client, original)!;
        recipe.payload.taskAutomationReference = agentAutomationTaskCommitReference({ actionId: origin.actionId, taskId: origin.taskId, taskRevision: 1, batch });
        const job = await f.jobs.create(MessageTriggerJobEntity.create(recipe));
        await f.lock.runExclusive(f.branchId, tx => gate.bindMaterialization(tx, job, (candidate, transaction) => sms.resolveCanonicalDeliverySnapshot(candidate, transaction)));
        expect(job.payload.agentAutomationSeal).toMatchObject({ authorityId: authority.id });
        const sealedSource = JSON.stringify(agentAutomationSourcePayload(job.payload, job.templateKey));
        const sealBytes = JSON.stringify(job.payload.agentAutomationSeal);
        const activation = new MessageAutomationActivationService(f.db as never, f.lock, {} as never);
        const core = new MessageTriggerService(f.db as never, new MessageTriggerDeliveryService(sms), { getApprovedBranchIds: async () => new Set([f.branchId]) } as never,
            ruleRepository as never, f.jobs, f.logs, templates as never, {} as never, f.settings, undefined, activation, f.lock, sourceReader as never, gate,
            undefined, new SmsAutomationSafeguardService(f.db as never, activation));
        await core.dispatchPendingJobNow(job.id, { expectedBranchId: f.branchId });
        const held = (await f.jobs.findByIdInBranch(f.branchId, job.id))!;
        expect(held).toMatchObject({ status: "pending", attempts: 0, nextAttemptAt: release, claimToken: null });
        expect(JSON.stringify(agentAutomationSourcePayload(held.payload, held.templateKey))).toBe(sealedSource);
        expect(JSON.stringify(held.payload.agentAutomationSeal)).toBe(sealBytes);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        if (changed) client.phone = "01000000022";
        jest.setSystemTime(release);
        await core.dispatchPendingJobNow(job.id, { expectedBranchId: f.branchId });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(changed ? 0 : 1);
        expect(JSON.stringify((await f.jobs.findByIdInBranch(f.branchId, job.id))!.payload.agentAutomationSeal)).toBe(sealBytes);
    });
});
