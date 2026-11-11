import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import * as evaluator from "domain/message-policy-evaluator";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { AgentAutomationDispatchUncertainError } from "domain/errors/agent-automation-dispatch-uncertain.error";
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
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { buildSmsProviderAcceptanceFingerprint, buildSmsProviderAcceptanceKey } from "application/services/sms-provider-acceptance.service";
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
function expectPublicRetryVariables(variables: Record<string, string>) {
    for (const key of ["manualRecipientBindings", "quietHoursDisposition", "quietHoursReleaseAt", "quietHoursOriginalScheduledFor",
        "quietHoursPolicyRevision", "quietHoursReason", "manualQueueMode", "manualQueueCount", "manualQueueOrdinal", "manualQueueStatus",
        "manualQueueScheduledAt", "manualQueueRequestKey", "manualQueueFingerprintInput", "manualQueueSenderIdentity", "manualQueueReason",
        "retryInvocation", "retrySenderIdentity"]) expect(variables).not.toHaveProperty(key);
}
function memoryQueue() {
    const branchId = "88000000-0000-4000-8000-000000000001";
    const tables: Record<string, Row[]> = { message_log: [], message_trigger_job: [], message_trigger_rule: [], message_trigger_rule_branch_override: [], system_setting: [],
        client: [{ id: 7, branchId, name: "synthetic", phone: "01000000011", deletedAt: null }], employee: [] };
    let active = false;
    let commitFailure = false;
    let logCasFailure = false;
    let afterPrepared: ((row: Row) => void) | undefined;
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
            if ("lte" in predicate) return actual != null && Number(actual) <= Number(predicate["lte"]);
            return true;
        }
        return value === undefined || row[key] === value;
    });
    const model = (name: string) => ({
        findUnique: jest.fn(async ({ where, include }: { where: Row; include?: Row }) => {
            const row = structuredClone(tables[name]!.find(row => matches(row, where)) ?? null);
            if (row && include?.["rule"]) row["rule"] = structuredClone(tables["message_trigger_rule"]!.find(rule => rule["id"] === row["ruleId"]) ?? null);
            return row;
        }),
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
            tables[name]!.push(row);
            const result = structuredClone(row);
            if (name === "message_log" && !active) afterPrepared?.(result);
            return result;
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
        message_trigger_rule_branch_override: model("message_trigger_rule_branch_override"),
        client: model("client"), employee: model("employee"), system_setting: model("system_setting"),
        $executeRaw: jest.fn(async () => 1),
        $transaction: jest.fn(async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
            expect(active).toBe(false); active = true;
            const snapshot = structuredClone(tables);
            try { const result = await work(db as never); if (commitFailure) throw new Error("late commit failure"); return result; }
            catch (error) { for (const key of Object.keys(tables)) tables[key] = snapshot[key]!; throw error; }
            finally { active = false; }
        }),
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            if (sql.sql.includes("SELECT ml.id")) return duplicateMatches;
            if (sql.sql.includes("WITH RECURSIVE ancestors")) return tables["message_log"]!.map(log => ({ id: log["id"] }));
            if (sql.sql.includes('FROM "user"')) return [...tables["client"]!.map(client => ({ phone: client["phone"], group_name: "CLIENT" })), ...tables["employee"]!.map(employee => ({ phone: employee["phone"], group_name: "CAREGIVER" }))];
            if (sql.sql.includes("SELECT id, branch_id, is_active, template_key, target_client_status, retry_on_failure")) return tables["message_trigger_rule"]!.filter(rule => sql.values.includes(rule["id"] as string)).map(rule => ({
                id: rule["id"], branch_id: rule["branchId"], is_active: rule["isActive"], template_key: rule["templateKey"],
                target_client_status: rule["targetClientStatus"], retry_on_failure: rule["retryOnFailure"],
            }));
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
    const readSetting = async (settingKey: string) => tables["system_setting"]!.find(row => row["key"] === settingKey)?.["value"] ?? null;
    const get = { execute: readSetting, executeWithDefault: async (settingKey: string, fallback: string) => await readSetting(settingKey) ?? fallback };
    const update = { executeIfVersion: async (settingKey: string, value: string, expected: string, versionOf: (raw: string | null) => string) => {
        const row = tables["system_setting"]!.find(item => item["key"] === settingKey)!;
        if (versionOf(row["value"] as string) !== expected) return null;
        row["value"] = value; return { value };
    } };
    const settings = new SystemSettingService(get as never, update as never, undefined, undefined, undefined, jobs, logs, lock);
    const quiet = new MessageQuietHoursService(settings, logs, lock);
    const duplicates = new MessageDuplicateCheckService(logs, { getMessageSettingsPolicyEnabled: async () => false } as never, get as never);
    const approval = { ensureApproved: jest.fn(async () => { expect(active).toBe(false); }), getApprovedBranchIds: async () => new Set([branchId]) };
    const templates = { findByKey: jest.fn(() => { throw new Error("Automatic renderer must not run"); }) };
    const aligo = { sendSms: jest.fn(async (request: Row) => {
        expect(active).toBe(false);
        return { request, response: { result_code: 1, message: "accepted", msg_id: 91, success_cnt: 1, error_cnt: 0 } };
    }) };
    const sender = { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) };
    const gate = new AgentAutomationDeliveryGateService(db as never, lock, {} as never);
    const sms = new SmsTriggerDeliveryService(aligo as never, templates as never, logs, new SmsProviderAcceptanceService(logs), undefined, gate,
        undefined, settings, undefined, quiet, jobs, sender as never);
    const acceptance = new SmsProviderAcceptanceService(logs);
    const activation = new MessageAutomationActivationService(db as never, lock, {} as never);
    const retry = new SmsRetryService(logs, aligo as never, approval as never, acceptance, activation, undefined, sms, jobs, undefined, settings, quiet, sender as never);
    const core = new MessageTriggerService(db as never, new MessageTriggerDeliveryService(sms), approval as never, {} as never, jobs, logs,
        templates as never, {} as never, settings, undefined, activation, lock);
    const controller = new MessageDeliveryController(aligo as never, approval as never, db as never, duplicates, quiet, jobs, sender as never);
    const send = (extra = {}) => controller.sendSms({ branchId }, { receiver: "01000000011", message: "  synthetic {{literal}}\n", idempotencyKey: "body-key", ...extra }, "ignored-header");
    return { branchId, db, tables, jobs, logs, settings, lock, core, sms, retry, controller, configuration, send, aligo, templates, approval, acceptance, activation, sender, quiet,
        newDuplicates: () => { duplicateMatches = [{ id: 999, sentAt: new Date(Date.now()) }]; },
        configure: (draft: typeof configuration) => { tables["system_setting"]![0]!["value"] = JSON.stringify(draft); },
        afterPrepared: (hook: (row: Row) => void) => { afterPrepared = hook; },
        commitFailure: () => { commitFailure = true; }, logCasFailure: () => { logCasFailure = true; } };
}


describe("manual final admission queue conversion", () => {
    const beforeQuiet = new Date("2026-11-03T12:59:59.000Z");
    const quietStart = new Date("2026-11-03T13:00:00.000Z");
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(beforeQuiet.getTime()));
    afterEach(() => jest.restoreAllMocks());
    function batch(f: ReturnType<typeof memoryQueue>) {
        f.tables["employee"]!.push({ id: 11, branchId: f.branchId, name: "synthetic employee", phone: "01000000022", deletedAt: null });
        return { receiver: "010-0000-0022,01000000011,01000000022", title: "  final title  ", msgType: "LMS" as const, testMode: true };
    }
    const writes = (f: ReturnType<typeof memoryQueue>) => [f.db.message_log.create, f.db.message_log.updateMany,
        f.db.message_log.update, f.db.message_trigger_job.create, f.db.message_trigger_job.updateMany,
        f.db.message_trigger_rule.upsert, f.db.$executeRaw, f.db.$transaction].map(mock => mock.mock.calls.length);

    it.each([1, 2])("converts final 22:00 DEFER for %i recipients and replays every ordinal without writes", async count => {
        const f = memoryQueue();
        const request = count === 2 ? batch(f) : { title: "  final title  ", msgType: "LMS" as const, testMode: true };
        let prepared!: Row;
        f.afterPrepared(row => {
            // Simulate unrelated server metadata present in the prepared snapshot.
            (row["variables"] as Row)["serverMetadata"] = "preserved";
            (f.tables["message_log"]![0]!["variables"] as Row)["serverMetadata"] = "preserved";
            prepared = row;
            jest.mocked(Date.now).mockReturnValue(quietStart.getTime());
        });
        const response = await f.send(request);
        expect(response).toMatchObject({ outcome: "deferred", request: { idempotencyKey: "body-key" } });
        expect(response).not.toHaveProperty("result");
        expect(response).not.toHaveProperty("sent");
        expect(f.tables["message_log"]).toHaveLength(count); expect(f.tables["message_trigger_job"]).toHaveLength(count);
        const rootKey = buildSmsProviderAcceptanceKey("manual", `${f.branchId}:body-key`);
        expect(prepared).toMatchObject({ receiver: count === 2 ? "01000000022,01000000011" : "01000000011",
            templateKey: "final title", status: "pending", triggerJobId: null, attempts: 0, providerCallStartedAt: null });
        for (let ordinal = 0; ordinal < count; ordinal++) {
            const log = f.tables["message_log"]![ordinal]!;
            const source = f.tables["message_trigger_job"]![ordinal]!;
            const phone = ordinal === 0 ? "01000000011" : "01000000022";
            const key = ordinal === 0 ? rootKey : buildSmsProviderAcceptanceKey("manual", `${rootKey}:ordinal:${ordinal}`);
            expect(log).toMatchObject({ id: ordinal === 0 ? prepared["id"] : expect.any(Number), branchId: f.branchId,
                providerAcceptanceKey: key, providerAcceptanceFingerprint: prepared["providerAcceptanceFingerprint"],
                receiver: phone, recipientPhone: phone, recipientName: ordinal === 0 ? "synthetic" : "synthetic employee",
                clientId: ordinal === 0 ? 7 : null, templateKey: "manual_sms", messageBody: "  synthetic {{literal}}\n",
                status: "pending", attempts: 0, providerAcceptanceState: "prepared", providerCallStartedAt: null,
                variables: { manualQueueOrdinal: String(ordinal), manualQueueCount: String(count), manualQueueStatus: "deferred",
                    quietHoursDisposition: "DEFER", quietHoursReleaseAt: release.toISOString(), quietHoursOriginalScheduledFor: beforeQuiet.toISOString(),
                    quietHoursPolicyRevision: expect.any(String), title: "  final title  ", msgType: "LMS", testMode: "true",
                    employeeId: ordinal === 0 ? null : 11 } });
            expect(log["triggerJobId"]).toBe(source["id"]);
            expect(JSON.parse((log["variables"] as Row)["manualRecipientBindings"] as string)).toEqual({
                version: 1, branchId: f.branchId, recipients: [{ kind: ordinal === 0 ? "CLIENT" : "CAREGIVER", id: ordinal === 0 ? 7 : 11, phone }],
            });
            expect(log["variables"]).not.toHaveProperty("scheduledDate"); expect(log["variables"]).not.toHaveProperty("scheduledTime");
            const input = JSON.parse((log["variables"] as Row)["manualQueueFingerprintInput"] as string) as Row;
            expect(input).toMatchObject({ receiver: prepared["receiver"], message: prepared["messageBody"], title: "final title", testMode: true });
            expect(buildSmsProviderAcceptanceFingerprint(input)).toBe(prepared["providerAcceptanceFingerprint"]);
            expect(source).toMatchObject({ scheduledFor: beforeQuiet, nextAttemptAt: release, attempts: 0,
                recipientPhone: phone, dedupeKey: `manual-sms:${f.branchId}:${key}`, payload: { existingMessageLogId: log["id"] } });
        }
        expect(f.tables["message_log"]![0]!["variables"]).toMatchObject({ serverMetadata: "preserved" });
        expect(prepared["triggerJobId"]).toBeNull(); expect(prepared["variables"]).not.toHaveProperty("manualQueueMode");
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        f.configuration.quietHours.enabled = false; f.configure(f.configuration);
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const before = structuredClone(f.tables); const calls = writes(f);
        expect(await f.send(request)).toEqual(response);
        expect(f.tables).toEqual(before); expect(writes(f)).toEqual(calls); expect(f.aligo.sendSms).not.toHaveBeenCalled();
        // The converted root and sibling both satisfy the real manual source validator.
        for (const source of f.tables["message_trigger_job"]!) {
            const entity = (await f.jobs.findByIdInBranch(f.branchId, source["id"] as string))!;
            await expect(f.sms.resolveDeliverySnapshot(entity)).resolves.toMatchObject({ receiver: source["recipientPhone"], title: "final title" });
        }
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });

    it.each(["DEFER", "CANCEL"] as const)("uses changed policy for final %s and preserves mixed recipient decisions", async action => {
        const f = memoryQueue(); const request = batch(f);
        f.configuration.quietHours.enabled = false; f.configure(f.configuration);
        f.afterPrepared(() => {
            Object.assign(f.configuration.quietHours, { enabled: true, start: "21:00", recipientGroups: ["CLIENT"], action });
            f.configure(f.configuration);
        });
        const response = await f.send(request);
        expect(response).toMatchObject({ outcome: "mixed", items: [
            { recipientPhone: "01000000011", status: action === "DEFER" ? "deferred" : "canceled",
                reason: `message_quiet_hours:${action}`, scheduledAt: action === "DEFER" ? release.toISOString() : beforeQuiet.toISOString() },
            { recipientPhone: "01000000022", status: "queued", scheduledAt: beforeQuiet.toISOString() },
        ] });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: action === "CANCEL" ? "failed" : "pending", attempts: 0 });
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: action === "CANCEL" ? "canceled" : "pending", attempts: 0 });
        f.configuration.quietHours.enabled = false; f.configure(f.configuration);
        const calls = writes(f); expect(await f.send(request)).toEqual(response); expect(writes(f)).toEqual(calls);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });

    it("returns final single CANCEL truthfully and never revives the root on replay", async () => {
        const f = memoryQueue(); let prepared!: Row;
        f.afterPrepared(row => { prepared = row; f.configuration.quietHours.action = "CANCEL"; f.configure(f.configuration); jest.mocked(Date.now).mockReturnValue(quietStart.getTime()); });
        const response = await f.send();
        expect(response).toMatchObject({ outcome: "canceled", items: [{ messageLogId: prepared["id"], status: "canceled", reason: "message_quiet_hours:CANCEL" }] });
        expect(f.tables["message_log"]![0]).toMatchObject({ providerAcceptanceKey: prepared["providerAcceptanceKey"], providerAcceptanceFingerprint: prepared["providerAcceptanceFingerprint"],
            status: "failed", attempts: 0, providerCallStartedAt: null });
        expect(f.tables["message_trigger_job"]).toHaveLength(1);
        f.configuration.quietHours.enabled = false; f.configure(f.configuration);
        const calls = writes(f); expect(await f.send()).toEqual(response); expect(writes(f)).toEqual(calls);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });

    it.each(["root CAS", "sibling link CAS", "commit"])("rolls all conversion writes back on %s and leaves the prepared snapshot untouched", async fault => {
        const f = memoryQueue(); const request = batch(f); let prepared!: Row;
        f.afterPrepared(row => {
            prepared = row; jest.mocked(Date.now).mockReturnValue(quietStart.getTime());
            if (fault === "commit") f.commitFailure();
            else if (fault === "root CAS") f.logCasFailure();
            else {
                const update = f.db.message_log.updateMany.getMockImplementation()!;
                f.db.message_log.updateMany.mockImplementation(async args => args.data["triggerJobId"] && args.where["id"] !== row["id"] ? { count: 0 } : update(args));
            }
        });
        await expect(f.send(request)).rejects.toThrow();
        expect(f.tables["message_log"]).toEqual([prepared]); expect(f.tables["message_trigger_job"]).toHaveLength(0);
        expect(f.tables["message_trigger_rule"]).toHaveLength(0); expect(prepared["variables"]).not.toHaveProperty("manualQueueMode");
        expect(prepared["triggerJobId"]).toBeNull(); expect(prepared["providerCallStartedAt"]).toBeNull();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });

    it.each<[string, unknown]>([
        ["updatedAt", new Date("2026-11-03T13:00:00.001Z")], ["receiver", "01000000099"], ["recipientPhone", "01000000099"],
        ["recipientName", "changed"], ["clientId", 99], ["templateKey", "changed"], ["messageBody", "changed"],
        ["variables", { title: "changed" }], ["attempts", 1], ["status", "failed"], ["triggerJobId", "changed"],
        ["providerAcceptanceKey", "changed"], ["providerAcceptanceFingerprint", "changed"], ["providerAcceptanceState", "started"],
        ["providerCallStartedAt", quietStart], ["providerAcceptedAt", quietStart], ["providerReconciledAt", quietStart],
        ["providerReconciledBy", "changed"], ["providerReconciliationReason", "changed"], ["aligoMid", "91"],
    ])("rejects a stale prepared root when %s changed before the conversion", async (field, value) => {
        const f = memoryQueue();
        f.afterPrepared(() => { f.tables["message_log"]![0]![field] = value; jest.mocked(Date.now).mockReturnValue(quietStart.getTime()); });
        await expect(f.send()).rejects.toThrow();
        expect(f.tables["message_log"]).toHaveLength(1); expect(f.tables["message_log"]![0]![field]).toEqual(value);
        expect(f.db.message_log.updateMany).not.toHaveBeenCalled(); expect(f.tables["message_trigger_job"]).toHaveLength(0);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });

    it("validates the entire current batch before any final conversion write", async () => {
        const f = memoryQueue(); const request = batch(f); let prepared!: Row;
        f.afterPrepared(row => { prepared = row; f.tables["employee"]![0]!["phone"] = "01000000099"; jest.mocked(Date.now).mockReturnValue(quietStart.getTime()); });
        await expect(f.send(request)).rejects.toThrow();
        expect(f.tables["message_log"]).toEqual([prepared]); expect(f.db.message_log.updateMany).not.toHaveBeenCalled();
        expect(f.tables["message_trigger_job"]).toHaveLength(0); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });

    it.each(["replacement", "same-kind ambiguity", "cross-kind ambiguity"])("does not retarget a prepared batch after %s", async kind => {
        const f = memoryQueue(); const request = batch(f); let prepared!: Row;
        f.afterPrepared(row => {
            prepared = row;
            const owner = f.tables["employee"]![0]!;
            if (kind === "replacement") owner["id"] = 99;
            if (kind === "same-kind ambiguity") f.tables["employee"]!.push({ ...owner, id: 99 });
            if (kind === "cross-kind ambiguity") f.tables["client"]!.push({ ...owner, id: 99 });
            jest.mocked(Date.now).mockReturnValue(quietStart.getTime());
        });
        await expect(f.send(request)).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
        expect(f.tables["message_log"]).toEqual([prepared]); expect(f.tables["message_trigger_job"]).toHaveLength(0);
        expect(f.db.message_log.updateMany).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
});

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
    it.each(["07:00", "08:00"])("explicitly retries an internally scheduled %s manual rejection without provider reservation fields", async scheduledTime => {
        const f = memoryQueue();
        const reservation = { triggerType: "scheduled" as const, scheduledDate: "2026-11-04", scheduledTime };
        await f.send(reservation);
        const log = f.tables["message_log"]![0]!;
        const provenance = structuredClone(log["variables"] as Row);
        expect(log["variables"]).toMatchObject({ triggerType: "scheduled", manualQueueMode: "internal" });
        expect(log["variables"]).not.toHaveProperty("scheduledDate");
        const reject = (request: Row) => ({ request, response: { result_code: -99, message: "temporary rejection", msg_id: 0, success_cnt: 0, error_cnt: 1 } });
        f.aligo.sendSms.mockImplementationOnce(async request => reject(request));
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await f.core.dispatchPendingJobNow(log["triggerJobId"] as string, { expectedBranchId: f.branchId });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", providerAcceptanceState: "rejected", nextRetryAt: null });
        const retried = await f.retry.retryById(f.branchId, log["id"] as number);
        expect(retried).toMatchObject({ status: "sent", providerAcceptanceState: "accepted", variables: { retryOfLogId: "1" } });
        expectPublicRetryVariables(retried.variables);
        const storedRetry = (await f.logs.findByIdInBranch(f.branchId, retried.id))!;
        if (scheduledTime === "07:00") expect(storedRetry.variables).toMatchObject({ quietHoursDisposition: "DEFER",
            quietHoursReleaseAt: provenance["quietHoursReleaseAt"], quietHoursOriginalScheduledFor: provenance["quietHoursOriginalScheduledFor"] });
        expect(f.tables["message_log"]).toHaveLength(2);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(2);
        for (const [request] of f.aligo.sendSms.mock.calls) {
            expect(request).not.toHaveProperty("scheduledDate");
            expect(request).not.toHaveProperty("scheduledTime");
        }
    });
    it.each(["client changed", "client deleted", "employee changed", "employee deleted"])("atomically terminates the acceptance and same-key replay when %s", async mode => {
        const f = memoryQueue();
        const employee = mode.startsWith("employee");
        if (employee) f.tables["employee"]!.push({ id: 8, branchId: f.branchId, name: "synthetic employee", phone: "01000000033", deletedAt: null });
        const request = employee ? { employeeId: 8, receiver: "01000000033" } : {};
        await f.send(request);
        const row = f.tables[employee ? "employee" : "client"]![0]!;
        if (mode.endsWith("deleted")) row["deletedAt"] = release;
        else row["phone"] = "01000000044";
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        const reason = "메시지 발송 건너뜀: Manual recipient changed";
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", cancelReason: reason, nextAttemptAt: null, claimToken: null, processingDeadlineAt: null });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", errorMessage: reason, nextRetryAt: null, attempts: 0,
            providerAcceptanceState: "prepared", providerCallStartedAt: null,
            variables: { quietHoursDisposition: "CANCEL", manualQueueStatus: "canceled", manualQueueReason: reason } });
        f.configuration.quietHours.enabled = false; f.configure(f.configuration);
        // Replay still passes the controller's existing current-recipient validation.
        Object.assign(row, { phone: employee ? "01000000033" : "01000000011", deletedAt: null });
        expect(await f.send(request)).toMatchObject({ outcome: "canceled", items: [{ status: "canceled", reason }] });
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        expect(f.tables["message_log"]).toHaveLength(1);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["legacy", "incomplete internal schedule"])("retains historical schedule refusal for %s", async mode => {
        const f = memoryQueue();
        await f.send({ triggerType: "scheduled", scheduledDate: "2026-11-04", scheduledTime: "08:00" });
        f.aligo.sendSms.mockImplementationOnce(async request => ({ request,
            response: { result_code: -99, message: "temporary rejection", msg_id: 0, success_cnt: 0, error_cnt: 1 } }));
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const log = f.tables["message_log"]![0]!;
        await f.core.dispatchPendingJobNow(log["triggerJobId"] as string, { expectedBranchId: f.branchId });
        const variables = f.tables["message_log"]![0]!["variables"] as Row;
        if (mode === "legacy") delete variables["manualQueueMode"];
        else variables["scheduledDate"] = "20261104";
        const refused = await f.retry.retryById(f.branchId, log["id"] as number);
        expect(refused).toMatchObject({ status: "failed", nextRetryAt: null,
            errorMessage: "예약 발송 일시 형식이 올바르지 않아 재시도하지 않았습니다. 예약일과 예약시간을 확인해 주세요." });
        expect(f.tables["message_log"]).toHaveLength(1);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it("persists recipient cancellation when identity changes after preparation", async () => {
        const f = memoryQueue(); await f.send();
        const sendPrepared = f.sms.sendPreparedJob.bind(f.sms);
        jest.spyOn(f.sms, "sendPreparedJob").mockImplementation(async (claimed, preparation) => {
            f.tables["client"]![0]!["phone"] = "01000000044";
            return sendPrepared(claimed, preparation);
        });
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        await f.core.dispatchPendingJobNow(f.tables["message_trigger_job"]![0]!["id"] as string, { expectedBranchId: f.branchId });
        const reason = "메시지 발송 건너뜀: Manual recipient changed";
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", cancelReason: reason, claimToken: null, processingDeadlineAt: null });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", providerCallStartedAt: null,
            variables: { manualQueueStatus: "canceled", manualQueueReason: reason } });
        f.tables["client"]![0]!["phone"] = "01000000011";
        expect(await f.send()).toMatchObject({ outcome: "canceled", items: [{ reason }] });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["changed", "missing", "unavailable", "after preparation", "current"])("persists the exact sender cancellation and replay, with a current sender control: %s", async mode => {
        const f = memoryQueue(); await f.send();
        const changeSender = () => {
            const read = jest.spyOn(f.sender, "read");
            if (mode === "missing") read.mockReturnValue(undefined as never);
            else read.mockReturnValue({ availability: mode === "unavailable" ? "unavailable" : "available", identityDigest: "b".repeat(64) });
        };
        const sendPrepared = f.sms.sendPreparedJob.bind(f.sms);
        jest.spyOn(f.sms, "sendPreparedJob").mockImplementation(async (claimed, preparation) => {
            if (mode === "after preparation") changeSender();
            const result = await sendPrepared(claimed, preparation);
            if (mode === "after preparation") expect(claimed.canceledAt).toEqual(release);
            return result;
        });
        if (mode !== "after preparation" && mode !== "current") changeSender();
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const source = structuredClone(f.tables["message_trigger_job"]![0]!);
        await f.core.dispatchPendingJobNow(source["id"] as string, { expectedBranchId: f.branchId });
        const reason = "메시지 발송 건너뜀: Manual sender changed";
        if (mode === "current") {
            expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "sent" });
            expect(f.tables["message_log"]![0]).toMatchObject({ status: "sent", attempts: 1 });
            expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
            return;
        }
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", cancelReason: reason, canceledAt: release,
            nextAttemptAt: null, claimToken: null, processingDeadlineAt: null, scheduledFor: source["scheduledFor"], dedupeKey: source["dedupeKey"], payload: source["payload"] });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", errorMessage: reason, nextRetryAt: null, attempts: 0,
            providerAcceptanceState: "prepared", providerCallStartedAt: null,
            variables: { quietHoursDisposition: "CANCEL", manualQueueStatus: "canceled", manualQueueReason: reason } });
        jest.mocked(f.sender.read).mockRestore();
        expect(await f.send()).toMatchObject({ outcome: "canceled", items: [{ status: "canceled", reason }] });
        await f.core.dispatchPendingJobNow(source["id"] as string, { expectedBranchId: f.branchId });
        expect(f.tables["message_log"]).toHaveLength(1);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["holder", "FK", "key", "fingerprint", "source", "job source", "branch", "claim", "deadline", "provider started", "provider accepted"])("never terminalizes unproven source rows with a changed sender: %s", async mode => {
        const f = memoryQueue(); await f.send();
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        await f.lock.runExclusive(f.branchId, tx => f.jobs.claimPendingWithRuleFence(id, f.branchId, tx, new Date("2026-11-03T23:20:00.000Z")));
        const claimed = (await f.jobs.findByIdInBranch(f.branchId, id))!;
        jest.spyOn(f.sender, "read").mockReturnValue({ availability: "available", identityDigest: "b".repeat(64) });
        const log = f.tables["message_log"]![0]!;
        const current = f.tables["message_trigger_job"]![0]!;
        if (mode === "holder") f.tables["message_trigger_rule"] = [];
        if (mode === "FK") log["triggerJobId"] = "unrelated-job";
        if (mode === "key") log["providerAcceptanceKey"] = null;
        if (mode === "fingerprint") log["providerAcceptanceFingerprint"] = "unrelated-fingerprint";
        if (mode === "source") log["messageBody"] = "unrelated-body";
        if (mode === "job source") current["dedupeKey"] = "unrelated-source";
        if (mode === "branch") log["branchId"] = "unrelated-branch";
        if (mode === "claim") current["claimToken"] = "another-worker";
        if (mode === "deadline") current["processingDeadlineAt"] = release;
        if (mode === "provider started") Object.assign(log, { providerAcceptanceState: "started", providerCallStartedAt: release });
        if (mode === "provider accepted") Object.assign(log, { providerAcceptanceState: "accepted", providerAcceptedAt: release, aligoMid: "91" });
        const before = structuredClone(f.tables);
        const beforeEntity = structuredClone(claimed);
        f.db.message_trigger_job.updateMany.mockClear();
        f.db.message_log.updateMany.mockClear();
        await expect(f.sms.resolveDeliverySnapshot(claimed)).rejects.toThrow(AgentAutomationDispatchUncertainError);
        expect(f.tables).toEqual(before);
        expect(structuredClone(claimed)).toEqual(beforeEntity);
        expect(f.db.message_trigger_job.updateMany).not.toHaveBeenCalled();
        expect(f.db.message_log.updateMany).not.toHaveBeenCalled();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["recipient job CAS", "recipient log CAS", "recipient commit", "sender job CAS", "sender log CAS", "sender commit"])("rolls source cancellation back on %s failure without mutating the claimed entity", async mode => {
        const f = memoryQueue(); await f.send();
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        await f.lock.runExclusive(f.branchId, tx => f.jobs.claimPendingWithRuleFence(id, f.branchId, tx, new Date("2026-11-03T23:20:00.000Z")));
        const claimed = (await f.jobs.findByIdInBranch(f.branchId, id))!;
        if (mode.startsWith("sender")) jest.spyOn(f.sender, "read").mockReturnValue({ availability: "available", identityDigest: "b".repeat(64) });
        else f.tables["client"]![0]!["phone"] = "01000000044";
        const before = structuredClone(f.tables);
        const beforeEntity = structuredClone(claimed);
        if (mode.endsWith("job CAS")) f.db.message_trigger_job.updateMany.mockResolvedValueOnce({ count: 0 });
        else if (mode.endsWith("log CAS")) f.logCasFailure(); else f.commitFailure();
        await expect(f.sms.resolveDeliverySnapshot(claimed)).rejects.toThrow(mode.endsWith("commit") ? "late commit failure" : AgentAutomationDispatchUncertainError);
        expect(f.tables).toEqual(before);
        expect(structuredClone(claimed)).toEqual(beforeEntity);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["job CAS", "log CAS", "commit"])("rolls final sender cancellation back on %s failure before changing the claimed entity", async mode => {
        const f = memoryQueue(); await f.send();
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        await f.lock.runExclusive(f.branchId, tx => f.jobs.claimPendingWithRuleFence(id, f.branchId, tx, new Date("2026-11-03T23:20:00.000Z")));
        const claimed = (await f.jobs.findByIdInBranch(f.branchId, id))!;
        const preparation = (await f.sms.prepareJob(claimed))!;
        expect(preparation).not.toBeNull();
        claimed.markDispatchAuthorized();
        await f.jobs.update(claimed);
        jest.spyOn(f.sender, "read").mockReturnValue({ availability: "available", identityDigest: "b".repeat(64) });
        const before = structuredClone(f.tables);
        const beforeEntity = structuredClone(claimed);
        if (mode === "job CAS") f.db.message_trigger_job.updateMany.mockResolvedValueOnce({ count: 0 });
        else if (mode === "log CAS") f.logCasFailure(); else f.commitFailure();
        await expect(f.sms.sendPreparedJob(claimed, preparation)).rejects.toThrow(mode === "commit" ? "late commit failure" : AgentAutomationDispatchUncertainError);
        expect(f.tables).toEqual(before);
        expect(structuredClone(claimed)).toEqual(beforeEntity);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["claim", "deadline", "provider started", "provider accepted"])("preserves the stored recipient cancellation state after %s changes", async mode => {
        const f = memoryQueue(); await f.send();
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        await f.lock.runExclusive(f.branchId, tx => f.jobs.claimPendingWithRuleFence(id, f.branchId, tx, new Date("2026-11-03T23:20:00.000Z")));
        const claimed = (await f.jobs.findByIdInBranch(f.branchId, id))!;
        f.tables["client"]![0]!["phone"] = "01000000044";
        const log = f.tables["message_log"]![0]!;
        if (mode === "claim") f.tables["message_trigger_job"]![0]!["claimToken"] = "another-worker";
        if (mode === "deadline") f.tables["message_trigger_job"]![0]!["processingDeadlineAt"] = release;
        if (mode === "provider started") Object.assign(log, { providerAcceptanceState: "started", providerCallStartedAt: release });
        if (mode === "provider accepted") Object.assign(log, { providerAcceptanceState: "accepted", providerAcceptedAt: release, aligoMid: "91" });
        const before = structuredClone(f.tables);
        await expect(f.sms.resolveDeliverySnapshot(claimed)).rejects.toThrow();
        expect(f.tables).toEqual(before);
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


describe("unheld manual reservation expiry", () => {
    const reservation = { triggerType: "scheduled", scheduledDate: "2026-11-04", scheduledTime: "09:00" };
    const beforeExpiry = new Date("2026-11-04T00:59:59.999Z");
    const late = new Date("2026-11-04T02:00:00.000Z");
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(original.getTime()));
    afterEach(() => jest.restoreAllMocks());
    async function reserve() {
        const f = memoryQueue();
        f.configuration.quietHours.enabled = false;
        f.configuration.pastExpiryHours = 1;
        f.configure(f.configuration);
        expect(await f.send(reservation)).toMatchObject({ outcome: "queued" });
        return f;
    }
    it.each([false, true])("terminalizes only an expired reservation and truthfully replays it (expired=%s)", async expired => {
        const f = await reserve();
        const source = structuredClone(f.tables["message_trigger_job"]![0]!);
        const id = source["id"] as string;
        const unrelated = { ...structuredClone(f.tables["message_log"]![0]!), id: 99, triggerJobId: "unrelated-job",
            providerAcceptanceKey: "unrelated-key" };
        f.tables["message_log"]!.push(unrelated);
        jest.mocked(Date.now).mockReturnValue((expired ? late : beforeExpiry).getTime());
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        if (expired) {
            const reason = "기존 발송 예정 1시간 경과";
            expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", cancelReason: reason, canceledAt: late,
                nextAttemptAt: null, claimToken: null, processingDeadlineAt: null, attempts: 0,
                scheduledFor: source["scheduledFor"], dedupeKey: source["dedupeKey"], payload: source["payload"] });
            expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", errorMessage: reason, nextRetryAt: null, attempts: 0,
                providerAcceptanceState: "prepared", providerCallStartedAt: null, providerAcceptedAt: null,
                variables: { manualQueueStatus: "canceled", manualQueueReason: reason } });
            expect(await f.send(reservation)).toMatchObject({ outcome: "canceled", items: [{ status: "canceled", reason }] });
            expect(f.aligo.sendSms).not.toHaveBeenCalled();
        } else {
            expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "sent" });
            expect(f.tables["message_log"]![0]).toMatchObject({ status: "sent", providerAcceptanceState: "accepted", attempts: 1 });
            expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        }
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        expect(f.tables["message_log"]).toHaveLength(2);
        expect(f.tables["message_log"]![1]).toEqual(unrelated);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(expired ? 0 : 1);
    });
    it.each(["holder", "FK", "key", "fingerprint", "source", "branch", "claim", "deadline", "job source",
        "log attempted", "job attempted", "provider started", "provider accepted"])("preserves unproven expired acceptance: %s", async mode => {
        const f = await reserve();
        jest.mocked(Date.now).mockReturnValue(late.getTime());
        const claim = f.jobs.claimPendingWithRuleFence.bind(f.jobs);
        let before: typeof f.tables;
        jest.spyOn(f.jobs, "claimPendingWithRuleFence").mockImplementation(async (...args) => {
            const token = await claim(...args);
            const log = f.tables["message_log"]![0]!;
            const current = f.tables["message_trigger_job"]![0]!;
            if (mode === "holder") f.tables["message_trigger_rule"] = [];
            if (mode === "FK") log["triggerJobId"] = "unrelated-job";
            if (mode === "key") log["providerAcceptanceKey"] = "unrelated-key";
            if (mode === "fingerprint") log["providerAcceptanceFingerprint"] = "unrelated-fingerprint";
            if (mode === "source") log["messageBody"] = "unrelated-body";
            if (mode === "branch") log["branchId"] = "unrelated-branch";
            if (mode === "claim") current["claimToken"] = "another-worker";
            if (mode === "deadline") current["processingDeadlineAt"] = late;
            if (mode === "job source") current["dedupeKey"] = "unrelated-source";
            if (mode === "log attempted") log["attempts"] = 1;
            if (mode === "job attempted") current["attempts"] = 1;
            if (mode === "provider started") Object.assign(log, { providerAcceptanceState: "started", providerCallStartedAt: late });
            if (mode === "provider accepted") Object.assign(log, { providerAcceptanceState: "accepted", providerAcceptedAt: late, aligoMid: "91" });
            before = structuredClone(f.tables);
            return token;
        });
        await expect(f.core.dispatchPendingJobNow(f.tables["message_trigger_job"]![0]!["id"] as string,
            { expectedBranchId: f.branchId })).rejects.toThrow();
        expect(f.tables).toEqual(before!);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["job CAS", "log CAS", "commit"])("rolls expired cancellation back on %s failure", async mode => {
        const f = await reserve();
        jest.mocked(Date.now).mockReturnValue(late.getTime());
        const run = f.lock.runExclusive.bind(f.lock);
        let calls = 0;
        let before: typeof f.tables;
        jest.spyOn(f.lock, "runExclusive").mockImplementation(async (branchId, work) => {
            if (++calls === 2) {
                before = structuredClone(f.tables);
                if (mode === "job CAS") f.db.message_trigger_job.updateMany.mockResolvedValueOnce({ count: 0 });
                if (mode === "log CAS") f.logCasFailure();
                if (mode === "commit") f.commitFailure();
            }
            return run(branchId, work);
        });
        await expect(f.core.dispatchPendingJobNow(f.tables["message_trigger_job"]![0]!["id"] as string,
            { expectedBranchId: f.branchId })).rejects.toThrow();
        expect(f.tables).toEqual(before!);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
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
        const scheduler = new MessageRetrySchedulerService(f.logs, f.retry, { holdsLease: () => true } as never, f.settings);
        await scheduler.retryFailedMessages();
        const resumed = await f.logs.findByIdInBranch(f.branchId, held!.id);
        expect(resumed).toMatchObject({ id: 2, status: "sent", attempts: 2 });
        expect(f.tables["message_log"]).toHaveLength(2); expect(f.aligo.sendSms).toHaveBeenCalledTimes(2);
    });
});

describe("quiet holds on manual-owned jobs", () => {
    beforeEach(() => jest.useFakeTimers({ now: original }));
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

    it.each([
        { family: "agent", ruleId: "agent-sms:synthetic", dedupeKey: "agent-sms:synthetic", templateKey: MessageTriggerTemplateKey.INFO },
        { family: "manual link", ruleId: "system:service_record_link", dedupeKey: "system:service_record_link:schedule:10:primary:manual:88000000-0000-4000-8000-000000000010", templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK },
        { family: "manual service end", ruleId: "system:service_end_notice", dedupeKey: "system:service_end_notice:client:7:manual:88000000-0000-4000-8000-000000000010", templateKey: MessageTriggerTemplateKey.SERVICE_END_NOTICE },
    ])("reads the current due time and claims a $family hold in the branch transaction", async ({ ruleId, dedupeKey, templateKey }) => {
        const f = memoryQueue();
        const held = MessageTriggerJobEntity.create({ branchId: f.branchId, ruleId, dedupeKey, templateKey,
            scheduledFor: original, recipientType: MessageTriggerRecipientType.CLIENT,
            payload: { memberId: "synthetic", recipientName: "synthetic", recipientPhone: "01000000011", templateVariables: {} } });
        held.nextAttemptAt = release;
        const persisted = await f.jobs.create(held);
        await f.logs.save(MessageLogEntity.create({ branchId: f.branchId, provider: "aligo_sms", templateKey: "synthetic",
            triggerJobId: persisted.id, receiver: "01000000011", messageBody: "synthetic", providerAcceptanceKey: `hold:${persisted.id}`,
            providerAcceptanceFingerprint: "synthetic-fingerprint", providerAcceptanceState: "prepared",
            variables: evaluator.messageQuietHoldVariables({ releaseAt: release, originalScheduledFor: original,
                policyRevision: "synthetic-policy", reason: "message_quiet_hours:DEFER" }) }));
        // Stop at the claim boundary: token/source/provider fences have their
        // own suites. This regression proves all three ownership families can
        // reach the existing token-minting repository claim after a quiet hold.
        const claim = jest.spyOn(f.jobs, "claimPendingWithRuleFence").mockResolvedValue(null);
        const readHold = jest.spyOn(f.jobs, "readQuietHold");
        await f.core.dispatchPendingJobNow(persisted.id, { expectedBranchId: f.branchId });
        expect(claim).not.toHaveBeenCalled();
        jest.setSystemTime(release);
        await f.core.dispatchPendingJobNow(persisted.id, { expectedBranchId: f.branchId });
        expect(readHold).toHaveBeenLastCalledWith(expect.objectContaining({ id: persisted.id }), f.db);
        expect(claim).toHaveBeenCalledTimes(1);
        expect(claim).toHaveBeenCalledWith(persisted.id, f.branchId, f.db, expect.any(Date));
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "pending", scheduledFor: original, nextAttemptAt: release, attempts: 0 });
    });
});

describe("original manual batch identity across quiet retry", () => {
    const beforeQuiet = new Date("2026-11-03T12:59:59.000Z");
    beforeEach(() => jest.useFakeTimers({ now: beforeQuiet }));
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

    async function rejectedBatch(mixed = true) {
        const f = memoryQueue();
        f.tables[mixed ? "employee" : "client"]!.push({ id: 11, branchId: f.branchId, name: "second",
            phone: "+82 10-0000-0022", deletedAt: null });
        f.aligo.sendSms.mockImplementation(async request => ({ request,
            response: { result_code: -101, message: "rejected", msg_id: 0, success_cnt: 0, error_cnt: 2 } }));
        await expect(f.send({ receiver: "01000000022,01000000011,01000000022",
            manualRecipientBindings: "caller-forgery" })).rejects.toMatchObject({ response: { code: "MESSAGE_SEND_REJECTED" } });
        const source = (await f.logs.findByIdInBranch(f.branchId, 1))!;
        expect(JSON.parse(source.variables["manualRecipientBindings"]!)).toEqual({ version: 1, branchId: f.branchId, recipients: [
            { kind: mixed ? "CAREGIVER" : "CLIENT", id: 11, phone: "01000000022" }, { kind: "CLIENT", id: 7, phone: "01000000011" },
        ] });
        f.aligo.sendSms.mockClear();
        jest.setSystemTime(original);
        return { f, source };
    }

    async function heldBatch(mixed = true) {
        const { f, source } = await rejectedBatch(mixed);
        const publicHeld = await f.retry.retryById(f.branchId, source.id);
        expect(publicHeld).toMatchObject({ status: "pending", providerAcceptanceState: "prepared", providerCallStartedAt: null, nextRetryAt: release });
        expectPublicRetryVariables(publicHeld.variables);
        const held = (await f.logs.findByIdInBranch(f.branchId, publicHeld.id))!;
        expect(held).toMatchObject({ status: "pending", providerAcceptanceState: "prepared", providerCallStartedAt: null,
            nextRetryAt: release, variables: { retryInvocation: "manual", quietHoursDisposition: "DEFER",
                manualRecipientBindings: source.variables["manualRecipientBindings"] } });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        return { f, source, held };
    }

    it.each(["client", "employee", "employee with client context"])("preserves a legacy single %s without a batch snapshot", async kind => {
        const f = memoryQueue(); jest.setSystemTime(original);
        const employee = kind !== "client";
        if (employee) f.tables["employee"]!.push({ id: 11, branchId: f.branchId, phone: "01000000022", deletedAt: null });
        const draft = MessageLogEntity.create({ branchId: f.branchId, provider: "aligo_sms", templateKey: "manual_sms",
            receiver: employee ? "01000000022" : "01000000011", messageBody: "legacy single",
            ...(!employee || kind === "employee with client context" ? { clientId: 7 } : {}),
            variables: employee ? { employeeId: "11" } : {}, providerAcceptanceState: "rejected",
            providerAcceptanceKey: "legacy-single", providerAcceptanceFingerprint: "legacy-single-fingerprint" });
        draft.status = "failed"; draft.attempts = 1;
        const source = await f.logs.save(draft);
        const publicHeld = await f.retry.retryById(f.branchId, source.id);
        expect(publicHeld).toMatchObject({ nextRetryAt: release, providerCallStartedAt: null });
        expectPublicRetryVariables(publicHeld.variables);
        const held = (await f.logs.findByIdInBranch(f.branchId, publicHeld.id))!;
        expect(held.variables).toMatchObject({ quietHoursDisposition: "DEFER", retryInvocation: "manual", quietHoursReleaseAt: "2026-11-03T23:00:00.000Z" });
        jest.setSystemTime(release);
        expect(await f.retry.retry(held, "manual")).toMatchObject({ id: held.id, status: "sent" });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect((f.tables["message_log"]![1]!["variables"] as Row)["manualRecipientBindings"]).toBeUndefined();
    });

    it.each([false, true])("releases the unchanged original batch once (mixed=%s), ignoring owners in another branch", async mixed => {
        const { f, source, held } = await heldBatch(mixed);
        f.tables["client"]!.push({ id: 99, branchId: "other-branch", phone: "01000000022", deletedAt: null });
        f.aligo.sendSms.mockImplementation(async request => ({ request,
            response: { result_code: 1, message: "accepted", msg_id: 91, success_cnt: 2, error_cnt: 0 } }));
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        jest.setSystemTime(release);
        const result = await f.retry.retry(held, "manual");
        expect(result).toMatchObject({ id: held.id, status: "sent", receiver: "01000000022,01000000011",
            variables: { manualRecipientBindings: source.variables["manualRecipientBindings"] } });
        expect(begin).toHaveBeenCalledTimes(1);
        expect(begin).toHaveBeenCalledWith(expect.objectContaining({ id: held.id }), f.db);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(f.tables["message_log"]).toHaveLength(2);
        await f.retry.retry(result!, "manual");
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });

    const invalidProvenance = ["missing", "malformed", "object", "version", "branch", "missing member", "extra member",
        "duplicate phone", "duplicate identity", "invalid kind", "invalid id", "unnormalized phone", "forged identity"] as const;
    function corrupt(f: ReturnType<typeof memoryQueue>, kind: typeof invalidProvenance[number], row: Row) {
        const variables = row["variables"] as Row;
        const snapshot = JSON.parse(variables["manualRecipientBindings"] as string) as { version: number; branchId: string; recipients: Row[] };
        if (kind === "missing") { delete variables["manualRecipientBindings"]; return; }
        if (kind === "malformed") { variables["manualRecipientBindings"] = "{"; return; }
        if (kind === "object") { variables["manualRecipientBindings"] = snapshot; return; }
        if (kind === "version") snapshot.version = 2;
        if (kind === "branch") snapshot.branchId = "other-branch";
        if (kind === "missing member") snapshot.recipients.pop();
        if (kind === "extra member") snapshot.recipients.push({ kind: "CLIENT", id: 99, phone: "01000000099" });
        if (kind === "duplicate phone") snapshot.recipients[1] = { ...snapshot.recipients[0]! };
        if (kind === "duplicate identity") snapshot.recipients[0] = { kind: "CLIENT", id: 7, phone: "01000000022" };
        if (kind === "invalid kind") snapshot.recipients[0]!["kind"] = "STAFF";
        if (kind === "invalid id") snapshot.recipients[0]!["id"] = -1;
        if (kind === "unnormalized phone") snapshot.recipients[0]!["phone"] = "010-0000-0022";
        if (kind === "forged identity") snapshot.recipients[0]!["id"] = 99;
        variables["manualRecipientBindings"] = JSON.stringify(snapshot);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    }

    it.each(invalidProvenance)("refuses %s original provenance at hold without any ledger/entity write", async kind => {
        const { f, source } = await rejectedBatch();
        corrupt(f, kind, f.tables["message_log"]![0]!);
        const current = (await f.logs.findByIdInBranch(f.branchId, source.id))!;
        const before = structuredClone(f.tables);
        const start = jest.spyOn(f.logs, "startRetryAttempt");
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        await expect(f.retry.retryById(f.branchId, current.id)).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
        expect(start).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.tables).toEqual(before);
    });

    it.each([...invalidProvenance, "source mismatch"] as const)("refuses %s held provenance without a provider CAS or entity write", async kind => {
        const { f, held } = await heldBatch();
        if (kind === "source mismatch") {
            const snapshot = JSON.parse((f.tables["message_log"]![1]!["variables"] as Row)["manualRecipientBindings"] as string) as Row;
            (f.tables["message_log"]![1]!["variables"] as Row)["manualRecipientBindings"] = JSON.stringify({ ...snapshot, branchId: "other-branch" });
        } else {
            // Equal corruption on both rows must fail schema/identity checks too.
            for (const row of f.tables["message_log"]!) corrupt(f, kind, row);
        }
        const before = structuredClone(f.tables);
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        f.db.message_log.updateMany.mockClear(); f.db.message_log.update.mockClear(); f.db.message_log.create.mockClear();
        jest.setSystemTime(release);
        await expect(f.retry.retry(held, "manual")).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
        expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.db.message_log.updateMany).not.toHaveBeenCalled(); expect(f.db.message_log.update).not.toHaveBeenCalled();
        expect(f.db.message_log.create).not.toHaveBeenCalled(); expect(f.tables).toEqual(before);
    });

    it.each(["changed phone", "deleted", "other branch", "same-kind ambiguity", "cross-kind ambiguity", "reassigned owner"])(
        "rejects %s at fresh release without writes", async kind => {
            const { f, held } = await heldBatch();
            const owner = f.tables["employee"]![0]!;
            if (kind === "changed phone") owner["phone"] = "01000000099";
            if (kind === "deleted") owner["deletedAt"] = original;
            if (kind === "other branch") owner["branchId"] = "other-branch";
            if (kind === "same-kind ambiguity") f.tables["employee"]!.push({ ...owner, id: 12 });
            if (kind === "cross-kind ambiguity") f.tables["client"]!.push({ ...owner, id: 12 });
            if (kind === "reassigned owner") owner["id"] = 12;
            const before = structuredClone(f.tables); const begin = jest.spyOn(f.acceptance, "beginProviderCall");
            f.db.message_log.updateMany.mockClear();
            jest.setSystemTime(release);
            await expect(f.retry.retry(held, "manual")).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
            expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
            expect(f.db.message_log.updateMany).not.toHaveBeenCalled(); expect(f.tables).toEqual(before);
        });

    it.each(["owner", "source snapshot", "retry snapshot"])("rechecks %s inside FINAL admission after the outer resume read", async kind => {
        const { f, held } = await heldBatch();
        const before = structuredClone(f.tables);
        let locks = 0;
        f.db.$executeRaw.mockImplementation(async () => {
            if (++locks === 2) {
                if (kind === "owner") f.tables["employee"]![0]!["id"] = 99;
                else (f.tables["message_log"]![kind === "source snapshot" ? 0 : 1]!["variables"] as Row)["manualRecipientBindings"] = "{}";
            }
            return 1;
        });
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        f.db.message_log.updateMany.mockClear(); f.db.message_log.update.mockClear(); f.db.message_log.create.mockClear();
        jest.setSystemTime(release);
        await expect(f.retry.retry(held, "manual")).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
        expect(locks).toBe(2); expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.db.message_log.updateMany).not.toHaveBeenCalled(); expect(f.db.message_log.update).not.toHaveBeenCalled();
        expect(f.db.message_log.create).not.toHaveBeenCalled(); expect(f.tables).toEqual(before);
    });
});

describe("quiet retry scheduler release", () => {
    beforeEach(() => jest.useFakeTimers({ now: original }));
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

    async function holdStandaloneRetry(retryEnabled = true) {
        const f = memoryQueue();
        const draft = MessageLogEntity.create({ branchId: f.branchId, provider: "aligo_sms", templateKey: "manual_sms",
            receiver: "01000000011", clientId: 7, messageBody: "synthetic history retry", variables: {},
            providerAcceptanceKey: "synthetic-source", providerAcceptanceFingerprint: "synthetic-fingerprint", providerAcceptanceState: "rejected" });
        draft.status = "failed"; draft.attempts = 1;
        const source = await f.logs.save(draft);
        const held = (await f.retry.retry(source, "manual"))!;
        const scheduler = new MessageRetrySchedulerService(f.logs, f.retry, { holdsLease: () => true } as never,
            { getMessageSettingsPolicyEnabled: async () => retryEnabled } as never);
        return { f, held, scheduler };
    }

    it.each([false, true])("resumes a standalone manual hold through the real scheduler once (legacy uncertain marker=%s)", async legacy => {
        const { f, held, scheduler } = await holdStandaloneRetry(false);
        const automaticBoundary = jest.spyOn(f.activation, "runAutomaticRetryIfEnabled");
        f.approval.ensureApproved.mockClear();
        expect(held).toMatchObject({ id: 2, triggerJobId: null, status: "pending", attempts: 1,
            providerAcceptanceState: "prepared", providerCallStartedAt: null, nextRetryAt: release,
            variables: { retrySafety: "quiet-deferred", retryInvocation: "manual", retryOfLogId: "1" } });
        const acceptance = { providerAcceptanceKey: held.providerAcceptanceKey, providerAcceptanceFingerprint: held.providerAcceptanceFingerprint };
        if (legacy) (f.tables["message_log"]![1]!["variables"] as Row)["retrySafety"] = "uncertain";
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(f.tables["message_log"]).toHaveLength(2);
        expect(f.tables["message_log"]![1]).toMatchObject({ ...acceptance, id: held.id, status: "sent", attempts: 2, nextRetryAt: null });
        expect(f.approval.ensureApproved).toHaveBeenCalledTimes(1);
        expect(automaticBoundary).not.toHaveBeenCalled();
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });

    it.each(["started", "uncertain", "accepted", "bound accepted", "partial", "manual rejection", "source uncertain", "source accepted", "source manual rejection", "invalid metadata", "unrelated source"])("keeps %s retries away from the provider", async kind => {
        const { f, scheduler } = ["bound accepted", "source manual rejection"].includes(kind) ? await holdAutomaticRetry() : await holdStandaloneRetry();
        const row = f.tables["message_log"]![1]!;
        const variables = row["variables"] as Row;
        if (["started", "uncertain", "accepted"].includes(kind)) Object.assign(row, { providerAcceptanceState: kind, providerCallStartedAt: original });
        if (kind === "bound accepted") Object.assign(row, { providerAcceptanceState: "accepted", providerCallStartedAt: original, providerAcceptedAt: original });
        if (kind === "partial") variables["retrySafety"] = "partial";
        if (kind === "manual rejection") variables["retrySafety"] = "manual-provider-rejected";
        if (kind === "source uncertain" || kind === "source accepted") f.tables["message_log"]![0]!["providerAcceptanceState"] = kind === "source uncertain" ? "uncertain" : "accepted";
        if (kind === "source manual rejection") (f.tables["message_log"]![0]!["variables"] as Row)["retrySafety"] = "manual-provider-rejected";
        if (kind === "invalid metadata") variables["quietHoursReleaseAt"] = "invalid";
        if (kind === "unrelated source") variables["retryOfLogId"] = "999";
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.tables["message_log"]).toHaveLength(2);
    });

    it.each(["started", "uncertain"])("cannot clear the safety marker once the provider is %s", async state => {
        const { f, held } = await holdStandaloneRetry();
        Object.assign(f.tables["message_log"]![1]!, { providerAcceptanceState: state, providerCallStartedAt: original });
        const before = structuredClone(f.tables);
        await expect(f.lock.runExclusive(f.branchId, tx => f.logs.transitionQuietRetry(held,
            evaluator.parseMessageQuietHold(held.variables)!, false, tx))).rejects.toThrow("Quiet retry acceptance changed");
        expect(f.tables).toEqual(before);
    });

    it.each(["revoked", "unavailable"])("leaves a due hold unchanged when current approval is %s", async kind => {
        const { f, held, scheduler } = await holdStandaloneRetry(false);
        const before = structuredClone(f.tables);
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        f.approval.ensureApproved.mockClear().mockRejectedValue(kind === "unavailable" ? new ServiceUnavailableException() : new ForbiddenException());
        f.db.$transaction.mockClear();
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        expect(f.approval.ensureApproved).toHaveBeenCalledTimes(1);
        expect(f.db.$transaction).not.toHaveBeenCalled();
        expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.tables).toEqual(before);
        expect((await f.logs.findByIdInBranch(f.branchId, held.id))!.attempts).toBe(1);
    });

    async function holdAutomaticRetry(global = false, throughScheduler = false) {
        const f = memoryQueue();
        const ruleId = randomUUID();
        const rule: Row = { id: ruleId, branchId: global ? null : f.branchId, isActive: true, deletedAt: null,
            templateKey: "INFO", targetClientStatus: "all", retryOnFailure: true };
        f.tables["message_trigger_rule"]!.push(rule);
        const linked = await f.jobs.create(MessageTriggerJobEntity.create({ branchId: f.branchId, ruleId, clientId: 7,
            templateKey: MessageTriggerTemplateKey.INFO, dedupeKey: "automatic:quiet-retry", scheduledFor: original,
            recipientType: MessageTriggerRecipientType.CLIENT,
            payload: { memberId: "", recipientName: "synthetic", recipientPhone: "01000000011", templateVariables: {} } }));
        const draft = MessageLogEntity.create({ branchId: f.branchId, provider: "aligo_sms", templateKey: "INFO",
            triggerJobId: linked.id, receiver: "01000000011", clientId: 7, messageBody: "automatic held body",
            variables: {}, providerAcceptanceKey: "auto-source", providerAcceptanceFingerprint: "auto-source-fingerprint", providerAcceptanceState: "rejected" });
        draft.status = "failed"; draft.attempts = 1;
        if (throughScheduler) draft.nextRetryAt = original;
        const source = await f.logs.save(draft);
        const scheduler = new MessageRetrySchedulerService(f.logs, f.retry, { holdsLease: () => true } as never, f.settings);
        if (throughScheduler) {
            // The existing ordinary retry path also checks approval inside its
            // automatic boundary. This synthetic approval performs no DB reads.
            f.approval.ensureApproved.mockImplementation(async () => undefined);
            await scheduler.retryFailedMessages();
            const held = (await f.logs.findByIdInBranch(f.branchId, 2))!;
            return { f, rule, held, scheduler };
        }
        const pending = MessageLogEntity.create({ branchId: f.branchId, provider: "aligo_sms", templateKey: "INFO",
            triggerJobId: linked.id, receiver: source.receiver, clientId: 7, messageBody: source.messageBody,
            variables: { retryOfLogId: String(source.id), retryInvocation: "automatic", retrySafety: "uncertain" },
            providerAcceptanceKey: "auto-held", providerAcceptanceFingerprint: "auto-held-fingerprint", providerAcceptanceState: "prepared" });
        pending.attempts = 1;
        const saved = await f.logs.save(pending);
        await f.lock.runExclusive(f.branchId, tx => f.logs.transitionQuietRetry(saved, { releaseAt: release,
            originalScheduledFor: original, policyRevision: "stored-version", reason: "message_quiet_hours:DEFER" }, false, tx,
            undefined, "automatic", "a".repeat(64)));
        const held = (await f.logs.findByIdInBranch(f.branchId, saved.id))!;
        return { f, rule, held, scheduler };
    }

    it.each(["accepted", "rejected"])("continues an automatic quiet retry after a transient rejection, then stops at attempt three (%s)", async outcome => {
        const { f, held, scheduler } = await holdAutomaticRetry(false, true);
        expect(held).toMatchObject({ id: 2, status: "pending", attempts: 1, nextRetryAt: release,
            providerAcceptanceState: "prepared", providerCallStartedAt: null, providerAcceptedAt: null, aligoMid: null,
            variables: { retryOfLogId: "1", retryInvocation: "automatic", retrySafety: "quiet-deferred" } });
        const provenance = {
            quietHoursDisposition: "DEFER", quietHoursReleaseAt: "2026-11-03T23:00:00.000Z",
            quietHoursOriginalScheduledFor: "2026-11-03T13:30:00.000Z",
            quietHoursPolicyRevision: held.variables["quietHoursPolicyRevision"], quietHoursReason: "message_quiet_hours:DEFER",
        };
        expect(held.variables).toMatchObject(provenance);
        const boundary = jest.spyOn(f.activation, "runAutomaticRetryIfEnabled");
        const start = jest.spyOn(f.logs, "startRetryAttempt");
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        const successfulProvider = f.aligo.sendSms.getMockImplementation()!;
        const rejectProvider = async (request: Row) => {
            // Retain the fixture's assertion that provider calls happen outside transactions.
            await successfulProvider(request);
            return { request, response: { result_code: -1, message: "transient", msg_id: 0, success_cnt: 0, error_cnt: 1 } };
        };
        f.aligo.sendSms.mockImplementationOnce(rejectProvider);
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(start).not.toHaveBeenCalled();
        expect(begin).toHaveBeenCalledTimes(1);
        expect(f.tables["message_log"]).toHaveLength(2);
        const rejected = (await f.logs.findByIdInBranch(f.branchId, held.id))!;
        expect(rejected).toMatchObject({ id: 2, status: "failed", attempts: 2, providerAcceptanceState: "rejected",
            nextRetryAt: new Date("2026-11-03T23:05:00.000Z"),
            variables: { ...provenance, retryInvocation: "automatic", retrySafety: "provider-rejected" } });
        expect(boundary).toHaveBeenCalledTimes(1);
        jest.setSystemTime(new Date("2026-11-03T23:04:59.999Z"));
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        if (outcome === "rejected") f.aligo.sendSms.mockImplementationOnce(rejectProvider);
        boundary.mockClear();
        jest.setSystemTime(new Date("2026-11-03T23:05:00.000Z"));
        await scheduler.retryFailedMessages();
        expect(boundary).toHaveBeenCalledTimes(1);
        expect(boundary).toHaveBeenCalledWith(f.branchId, held.triggerJobId, expect.any(Function));
        expect(start).toHaveBeenCalledTimes(1);
        expect(begin).toHaveBeenCalledTimes(2);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(2);
        expect(f.tables["message_log"]).toHaveLength(3);
        const final = (await f.logs.findByIdInBranch(f.branchId, 3))!;
        expect(final).toMatchObject({ id: 3, status: outcome === "accepted" ? "sent" : "failed", attempts: 3,
            providerAcceptanceState: outcome === "accepted" ? "accepted" : "rejected", nextRetryAt: null,
            variables: { ...provenance, retryOfLogId: "2" } });
        expect(final.canRetry()).toBe(false);
        expect((await f.logs.findByIdInBranch(f.branchId, held.id))!.nextRetryAt).toBeNull();
        jest.setSystemTime(new Date("2026-11-03T23:10:00.000Z"));
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(2);
        expect(boundary).toHaveBeenCalledTimes(1);
        expect(f.tables["message_log"]).toHaveLength(3);
    });

    it("allows an explicit manual continuation after the released manual retry is rejected without scheduling it automatically", async () => {
        const { f, held, scheduler } = await holdStandaloneRetry();
        const boundary = jest.spyOn(f.activation, "runAutomaticRetryIfEnabled");
        f.aligo.sendSms.mockImplementationOnce(async request => ({ request,
            response: { result_code: -1, message: "transient", msg_id: 0, success_cnt: 0, error_cnt: 1 } }));
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        const rejected = (await f.logs.findByIdInBranch(f.branchId, held.id))!;
        expect(rejected).toMatchObject({ id: 2, status: "failed", attempts: 2, providerAcceptanceState: "rejected", nextRetryAt: null,
            variables: { quietHoursDisposition: "DEFER", retryInvocation: "manual", retrySafety: "manual-provider-rejected" } });
        jest.setSystemTime(new Date("2026-11-03T23:05:00.000Z"));
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        const continued = await f.retry.retryById(f.branchId, held.id);
        expect(continued).toMatchObject({ id: 3, status: "sent", attempts: 3, nextRetryAt: null,
            variables: { retryOfLogId: "2" } });
        expectPublicRetryVariables(continued.variables);
        const storedContinuation = (await f.logs.findByIdInBranch(f.branchId, continued.id))!;
        expect(storedContinuation).toMatchObject({ id: 3, status: "sent", attempts: 3, nextRetryAt: null,
            variables: { retryOfLogId: "2", quietHoursDisposition: "DEFER", quietHoursReleaseAt: "2026-11-03T23:00:00.000Z",
                quietHoursOriginalScheduledFor: "2026-11-03T13:30:00.000Z" } });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(2);
        expect(f.tables["message_log"]).toHaveLength(3);
        expect(boundary).not.toHaveBeenCalled();
    });

    it.each(["started", "uncertain", "accepted", "accepted timestamp", "provider message id", "pending rejected", "missing invocation", "invalid invocation"])("does not create a fresh attempt from a held %s row", async kind => {
        const { f, scheduler } = await holdAutomaticRetry();
        f.approval.ensureApproved.mockImplementation(async () => undefined);
        const row = f.tables["message_log"]![1]!;
        if (["started", "uncertain", "accepted"].includes(kind)) Object.assign(row, { status: "failed", providerAcceptanceState: kind, providerCallStartedAt: original });
        if (kind === "accepted timestamp") row["providerAcceptedAt"] = original;
        if (kind === "provider message id") row["aligoMid"] = "synthetic-91";
        if (kind === "pending rejected") row["providerAcceptanceState"] = "rejected";
        if (kind === "missing invocation") delete (row["variables"] as Row)["retryInvocation"];
        if (kind === "invalid invocation") (row["variables"] as Row)["retryInvocation"] = "invalid";
        const start = jest.spyOn(f.logs, "startRetryAttempt");
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        expect(start).not.toHaveBeenCalled();
        expect(begin).not.toHaveBeenCalled();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.tables["message_log"]).toHaveLength(2);
        expect(f.tables["message_log"]![1]!["attempts"]).toBe(1);
    });

    it.each(["allowed", "target match", "branch off", "inactive", "global override off", "retry off", "target mismatch", "sms retry off", "activation missing"])("rechecks the existing automatic retry boundary: %s", async mode => {
        const { f, rule, held, scheduler } = await holdAutomaticRetry(mode === "global override off");
        const allowed = mode === "allowed" || mode === "target match";
        if (mode === "branch off") f.tables["system_setting"]!.push({ key: `branch:${f.branchId}:message_policy:trigger-dispatch:enabled`, value: "false" });
        if (mode === "inactive") rule["isActive"] = false;
        if (mode === "global override off") {
            f.db.message_trigger_rule_branch_override.findUnique.mockResolvedValue({ isActive: false });
        }
        if (mode === "retry off") rule["retryOnFailure"] = false;
        if (mode === "target mismatch") { rule["targetClientStatus"] = "active"; f.tables["client"]![0]!["serviceStatus"] = "terminated"; }
        if (mode === "target match") {
            rule["targetClientStatus"] = "waiting";
            Object.assign(f.tables["client"]![0]!, { serviceStatus: "waiting", startDate: new Date("2099-06-01"), endDate: new Date("2099-06-30"), bookingConfirmedAt: original });
        }
        if (mode === "sms retry off") f.tables["system_setting"]!.push({ key: `branch:${f.branchId}:message_policy:sms-retry:enabled`, value: "false" });
        if (mode === "activation missing") Object.assign(f.retry, { messageAutomationActivationService: undefined });
        // Ordinary SMS retry does not depend on the Core trigger-job-retry switch.
        f.tables["system_setting"]!.push({ key: `branch:${f.branchId}:message_policy:trigger-job-retry:enabled`, value: "false" });
        const sourceBefore = structuredClone(f.tables["message_log"]![0]);
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        f.approval.ensureApproved.mockClear(); f.db.$transaction.mockClear();
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(begin).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(f.approval.ensureApproved).toHaveBeenCalledTimes(mode === "sms retry off" ? 0 : 1);
        // The fixture rejects nested root transactions and provider calls in a transaction.
        expect(f.db.$transaction).toHaveBeenCalledTimes(["sms retry off", "activation missing"].includes(mode) ? 0 : 1);
        expect(f.tables["message_log"]).toHaveLength(2);
        expect(f.tables["message_log"]![0]).toEqual(sourceBefore);
        const current = (await f.logs.findByIdInBranch(f.branchId, held.id))!;
        expect(current.attempts).toBe(allowed ? 2 : 1);
        if (mode === "retry off" || mode === "target mismatch") {
            expect(current).toMatchObject({ status: "failed", nextRetryAt: null });
            expect(current.errorMessage).toContain(mode === "retry off" ? "rule_retry_disabled" : "target_client_status_mismatch");
        } else if (!allowed) expect(current).toMatchObject({ status: "pending", nextRetryAt: release });
    });

    it.each(["invocation", "job FK"])("rejects a changed current %s before using the captured eligibility", async kind => {
        const { f, scheduler } = await holdAutomaticRetry();
        const boundary = f.activation.runAutomaticRetryIfEnabled.bind(f.activation);
        jest.spyOn(f.activation, "runAutomaticRetryIfEnabled").mockImplementation(async (branch, id, work) => {
            if (kind === "invocation") (f.tables["message_log"]![1]!["variables"] as Row)["retryInvocation"] = "manual";
            if (kind === "job FK") f.tables["message_log"]![1]!["triggerJobId"] = null;
            return boundary(branch, id, work);
        });
        const begin = jest.spyOn(f.acceptance, "beginProviderCall");
        jest.setSystemTime(release);
        await scheduler.retryFailedMessages();
        expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.tables["message_log"]![1]).toMatchObject({ status: "pending", attempts: 1, nextRetryAt: release });
    });
});

describe("eligible quiet capacity before ordinary dispatch", () => {
    beforeEach(() => jest.useFakeTimers({ now: release }));
    afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

    it("passes only approved policies before allocating capacity, so 100 denied or automatic-OFF holds cannot starve ordinary work", async () => {
        const f = memoryQueue();
        const unapproved = randomUUID(); const automaticOff = randomUUID();
        f.tables["system_setting"]!.push({ key: `branch:${automaticOff}:message_policy:trigger-dispatch:enabled`, value: "false" });
        const badHolds = Array.from({ length: 100 }, (_, index) => MessageTriggerJobEntity.create({ branchId: index < 50 ? unapproved : automaticOff,
            ruleId: randomUUID(), scheduledFor: original, recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.INFO,
            dedupeKey: `bad-hold:${index}`, payload: { memberId: "", recipientName: "synthetic", recipientPhone: "01000000011", templateVariables: {} } }));
        const ordinary = job(); Object.assign(ordinary, { branchId: f.branchId });
        const maintenance = f.core as unknown as { hasTriggerSchema(): Promise<boolean>; reclaimStaleProcessingJobs(): Promise<void>;
            recoverApprovedBranches(): Promise<void>; processStaleRuleRebuilds(): Promise<void>;
            dispatchClaimedJob(job: MessageTriggerJobEntity, sent: Set<string>, approved: Set<string>): Promise<boolean> };
        jest.spyOn(maintenance, "hasTriggerSchema").mockResolvedValue(true);
        jest.spyOn(maintenance, "reclaimStaleProcessingJobs").mockResolvedValue();
        jest.spyOn(maintenance, "recoverApprovedBranches").mockResolvedValue();
        jest.spyOn(maintenance, "processStaleRuleRebuilds").mockResolvedValue();
        jest.spyOn(f.jobs, "cancelOrphanedPending").mockResolvedValue(0);
        jest.spyOn(f.jobs, "findDueDispatchBranchIds").mockResolvedValue([unapproved, automaticOff, f.branchId]);
        jest.spyOn(f.approval, "getApprovedBranchIds").mockResolvedValue(new Set([automaticOff, f.branchId]));
        jest.spyOn(f.settings, "getMessageSettingsPolicyEnabled").mockImplementation(async (branch, policy) => branch !== automaticOff || policy !== "trigger-dispatch");
        const quiet = jest.spyOn(f.jobs, "findDueQuietQueueJobs").mockImplementation(async (eligibility, _now, limit) => {
            expect(eligibility.map(policy => policy.branchId)).toEqual([automaticOff, f.branchId]);
            return badHolds.filter(held => eligibility.some(policy => policy.branchId === held.branchId && policy.automaticEnabled)).slice(0, limit);
        });
        const ordinarySelection = jest.spyOn(f.jobs, "consumeDispatchSlotsAndFindDueJobs").mockResolvedValue([ordinary]);
        jest.spyOn(f.logs, "findSentTriggerJobIdsSystemScope").mockResolvedValue(new Set());
        const dispatch = jest.spyOn(maintenance, "dispatchClaimedJob").mockResolvedValue(true);
        await f.core.dispatchDueJobs();
        expect(quiet).toHaveBeenCalledWith(expect.any(Array), release, 100);
        expect(ordinarySelection).toHaveBeenCalledTimes(1);
        const ordinaryArgs: readonly unknown[] = ordinarySelection.mock.calls[0]!;
        expect(ordinaryArgs.slice(0, 3)).toEqual([expect.any(Array), release, 100]);
        expect(ordinaryArgs.length).toBeGreaterThanOrEqual(3);
        expect(ordinaryArgs.length).toBeLessThanOrEqual(4);
        const [, , , exclusions = []] = ordinaryArgs;
        expect(exclusions).toEqual([]);
        expect(dispatch).toHaveBeenCalledTimes(1); expect(dispatch.mock.calls[0]![0]).toBe(ordinary);
    });

    it("joins caller eligibility before quiet LIMIT, keeps branch round-robin and rejects empty capacity without SQL", async () => {
        const f = memoryQueue(); f.db.$queryRaw.mockResolvedValue([]);
        expect(await f.jobs.findDueQuietQueueJobs([], release)).toEqual([]);
        expect(await f.jobs.findDueQuietQueueJobs([{ branchId: f.branchId, automaticEnabled: false, retryEnabled: false, intervalMinutes: 1 }], release, 0)).toEqual([]);
        expect(f.db.$queryRaw).not.toHaveBeenCalled();
        await f.jobs.findDueQuietQueueJobs([{ branchId: f.branchId, automaticEnabled: false, retryEnabled: false, intervalMinutes: 1 }], release, 100);
        const query = f.db.$queryRaw.mock.calls[0]![0];
        expect(query.values).toContain(f.branchId); expect(query.values).toContain(false);
        expect(query.sql).toContain("INNER JOIN policy ON policy.branch_id = job.branch_id");
        expect(query.sql.indexOf("policy.automatic_enabled OR")).toBeLessThan(query.sql.indexOf("LIMIT"));
        expect(query.sql).toContain("PARTITION BY job.branch_id");
        expect(query.sql).toContain("ORDER BY ordinal, due, branch_id, id LIMIT");
        expect(query.sql).toContain("job.attempts = 0");
        expect(query.values.at(-1)).toBe(100);
    });
});

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../integrity/helpers/real-db";
import { createBranch, createClient, createMessageTriggerRule } from "../integrity/helpers/factories";
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
    async function pgSlice(options: { finalDefer?: boolean; batch?: boolean;
        onPrepared?: (row: Row, jobs: SbMessageTriggerJobRepository, branchId: string) => void } = {}) {
        if (options.finalDefer) jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T12:59:59.000Z"));
        const branch = await createBranch(handle.raw, tracker); branches.push(branch.id);
        const client = await createClient(handle.raw, tracker, { branchId: branch.id, name: "synthetic quiet", phone: "01000000011", phoneNormalized: "01000000011" });
        if (options.batch) await createClient(handle.raw, tracker, { branchId: branch.id, name: "synthetic second", phone: "01000000022", phoneNormalized: "01000000022" });
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
        const acceptance = new SmsProviderAcceptanceService(logs);
        const retry = new SmsRetryService(logs, aligo as never, approval as never, acceptance, undefined, undefined,
            undefined, jobs, undefined, settings, quiet, sender as never);
        let prepared: Row | undefined;
        if (options.finalDefer) {
            const pending = controller as unknown as { createPendingSmsLog(...args: unknown[]): Promise<{ row: Row; created: boolean; id: number }> };
            const createPending = pending.createPendingSmsLog.bind(controller);
            jest.spyOn(pending, "createPendingSmsLog").mockImplementation(async (...args) => {
                const result = await createPending(...args);
                prepared = structuredClone(result.row);
                jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T13:00:00.000Z"));
                options.onPrepared?.(prepared, jobs, branch.id);
                return result;
            });
        }
        const request = { clientId: options.batch ? null : client.id, receiver: options.batch ? "01000000022,01000000011" : "01000000011",
            message: "synthetic PG", idempotencyKey: "pg-queue", ...(options.finalDefer ? { title: "PG title", msgType: "LMS" as const, testMode: true } : {}) };
        const send = () => controller.sendSms({ branchId: branch.id }, request);
        const result = await send();
        if (!("items" in result)) throw new Error("Expected internal queue response");
        const item = result.items[0]!;
        return { branchId: branch.id, configuration, jobs, logs, settings, lock, core, aligo, sms, send, result, prepared,
            controller, quiet, acceptance, retry, jobId: item.jobId, logId: item.messageLogId };
    }

    it.each(["unchanged", "final owner replacement", "missing original", "snapshot mismatch"])(
        "preserves original immediate batch provenance through a real PostgreSQL quiet retry: %s", async mode => {
            const f = await pgSlice();
            const second = await createClient(handle.raw, tracker, { branchId: f.branchId, name: "batch second",
                phone: "01000000022", phoneNormalized: "01000000022" });
            jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T12:59:59.000Z"));
            f.aligo.sendSms.mockImplementation(async request => {
                expect(await handle.raw.message_log.count({ where: { branchId: f.branchId, providerAcceptanceState: "started" } })).toBe(1);
                return { request, response: { result_code: -101, message: "rejected", msg_id: 0, success_cnt: 0, error_cnt: 2 } };
            });
            await expect(f.controller.sendSms({ branchId: f.branchId }, { receiver: "01000000011,01000000022",
                message: "original PG batch", idempotencyKey: "pg-original-batch" })).rejects.toMatchObject({ response: { code: "MESSAGE_SEND_REJECTED" } });
            const sourceRow = await handle.raw.message_log.findFirstOrThrow({ where: { branchId: f.branchId, receiver: "01000000011,01000000022" } });
            const source = (await f.logs.findByIdInBranch(f.branchId, sourceRow.id))!;
            const first = await handle.raw.client.findFirstOrThrow({ where: { branchId: f.branchId, phone: "01000000011" } });
            const snapshot = JSON.stringify({ version: 1, branchId: f.branchId, recipients: [
                { kind: "CLIENT", id: first.id, phone: "01000000011" }, { kind: "CLIENT", id: second.id, phone: "01000000022" },
            ] });
            expect(source.variables["manualRecipientBindings"]).toBe(snapshot);
            f.aligo.sendSms.mockClear();
            jest.mocked(Date.now).mockReturnValue(original.getTime());
            if (mode === "missing original") {
                const variables = { ...source.variables }; delete variables["manualRecipientBindings"];
                await handle.raw.message_log.update({ where: { id: source.id }, data: { variables } });
                const before = await handle.raw.message_log.findMany({ where: { branchId: f.branchId }, orderBy: { id: "asc" } });
                const start = jest.spyOn(f.logs, "startRetryAttempt"); const begin = jest.spyOn(f.acceptance, "beginProviderCall");
                await expect(f.retry.retryById(f.branchId, source.id)).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
                expect(start).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
                expect(await handle.raw.message_log.findMany({ where: { branchId: f.branchId }, orderBy: { id: "asc" } })).toEqual(before);
                return;
            }
            // PostgreSQL defaults use its real clock. Bind only the synthetic
            // retry fixture's createdAt to the same literal clock as admission.
            const startRetryAttempt = f.logs.startRetryAttempt.bind(f.logs);
            jest.spyOn(f.logs, "startRetryAttempt").mockImplementation(async (...args) => {
                const started = await startRetryAttempt(...args);
                if (started.kind === "started") {
                    await handle.raw.message_log.update({ where: { id: started.log.id }, data: { createdAt: original } });
                    started.log.createdAt = original;
                }
                return started;
            });
            const publicHeld = await f.retry.retryById(f.branchId, source.id);
            expectPublicRetryVariables(publicHeld.variables);
            expect(publicHeld).toMatchObject({ status: "pending", providerCallStartedAt: null, nextRetryAt: release });
            const held = (await f.logs.findByIdInBranch(f.branchId, publicHeld.id))!;
            expect(held.variables["manualRecipientBindings"]).toBe(snapshot);
            expect(held).toMatchObject({ status: "pending", providerCallStartedAt: null, nextRetryAt: release });
            if (mode === "snapshot mismatch") await handle.raw.message_log.update({ where: { id: held.id },
                data: { variables: { ...held.variables, manualRecipientBindings: "{}" } } });
            const before = await handle.raw.message_log.findMany({ where: { branchId: f.branchId }, orderBy: { id: "asc" } });
            let finalBoundary = false;
            const runExclusive = f.lock.runExclusive.bind(f.lock);
            if (mode === "final owner replacement") {
                f.lock.runExclusive = async <T>(branchId: string, work: (tx: Prisma.TransactionClient) => Promise<T>, transaction?: Prisma.TransactionClient): Promise<T> =>
                    runExclusive(branchId, async tx => {
                        if (transaction) {
                            finalBoundary = true;
                            await tx.client.update({ where: { id: second.id }, data: { phone: "01000000099", phoneNormalized: "01000000099" } });
                            await tx.client.update({ where: { id: first.id }, data: { phone: "01000000022", phoneNormalized: "01000000022" } });
                        }
                        return work(tx);
                    }, transaction);
            }
            const begin = jest.spyOn(f.acceptance, "beginProviderCall");
            jest.mocked(Date.now).mockReturnValue(release.getTime());
            if (mode === "unchanged") {
                f.aligo.sendSms.mockImplementation(async request => ({ request,
                    response: { result_code: 1, message: "accepted", msg_id: 91, success_cnt: 2, error_cnt: 0 } }));
                const sent = await f.retry.retry(held, "manual");
                expect(sent).toMatchObject({ id: held.id, status: "sent", variables: { manualRecipientBindings: snapshot } });
                expect(begin).toHaveBeenCalledTimes(1); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
                await f.retry.retry(sent!, "manual"); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
            } else {
                await expect(f.retry.retry(held, "manual")).rejects.toMatchObject({ response: { code: "REQUEST_CONFLICT" } });
                expect(finalBoundary).toBe(mode === "final owner replacement");
                expect(begin).not.toHaveBeenCalled(); expect(f.aligo.sendSms).not.toHaveBeenCalled();
                expect(await handle.raw.message_log.findMany({ where: { branchId: f.branchId }, orderBy: { id: "asc" } })).toEqual(before);
                expect((await handle.raw.client.findUniqueOrThrow({ where: { id: second.id } })).phone).toBe("01000000022");
            }
        });

    it.each([false, true])("atomically converts final DEFER in PostgreSQL (batch=%s), preserving source identity and replay", async batch => {
        const f = await pgSlice({ finalDefer: true, batch });
        const prepared = f.prepared!;
        expect(f.result).toMatchObject({ outcome: "deferred" }); expect(f.result).not.toHaveProperty("result");
        const logs = await handle.raw.message_log.findMany({ where: { branchId: f.branchId }, orderBy: { id: "asc" } });
        const jobs = await handle.raw.message_trigger_job.findMany({ where: { branchId: f.branchId }, orderBy: { recipientPhone: "asc" } });
        expect(logs).toHaveLength(batch ? 2 : 1); expect(jobs).toHaveLength(logs.length);
        expect(logs[0]).toMatchObject({ id: prepared["id"], createdAt: prepared["createdAt"], providerAcceptanceKey: prepared["providerAcceptanceKey"],
            providerAcceptanceFingerprint: prepared["providerAcceptanceFingerprint"], templateKey: "manual_sms", recipientPhone: "01000000011", receiver: "01000000011" });
        for (let ordinal = 0; ordinal < logs.length; ordinal++) {
            const log = logs[ordinal]!; const source = jobs[ordinal]!;
            const expectedKey = ordinal === 0 ? prepared["providerAcceptanceKey"] : buildSmsProviderAcceptanceKey("manual", `${prepared["providerAcceptanceKey"]}:ordinal:${ordinal}`);
            expect(log).toMatchObject({ triggerJobId: source.id, receiver: source.recipientPhone, recipientPhone: source.recipientPhone,
                clientId: source.clientId, status: "pending", attempts: 0, providerAcceptanceState: "prepared", providerCallStartedAt: null,
                providerAcceptanceKey: expectedKey, providerAcceptanceFingerprint: prepared["providerAcceptanceFingerprint"], messageBody: "synthetic PG",
                variables: { manualQueueCount: String(logs.length), manualQueueOrdinal: String(ordinal), manualQueueStatus: "deferred",
                    title: "PG title", msgType: "LMS", testMode: "true", employeeId: null,
                    quietHoursOriginalScheduledFor: "2026-11-03T12:59:59.000Z", quietHoursReleaseAt: release.toISOString(), quietHoursPolicyRevision: expect.any(String) } });
            expect(source).toMatchObject({ scheduledFor: new Date("2026-11-03T12:59:59.000Z"), nextAttemptAt: release, attempts: 0,
                payload: { existingMessageLogId: log.id, recipientPhone: log.recipientPhone, recipientName: log.recipientName,
                    templateVariables: { title: "PG title", msgType: "LMS", testMode: "true" } } });
            const variables = log.variables as Row;
            expect(buildSmsProviderAcceptanceFingerprint(JSON.parse(variables["manualQueueFingerprintInput"] as string) as Row)).toBe(prepared["providerAcceptanceFingerprint"]);
            expect(variables).not.toHaveProperty("scheduledDate"); expect(variables).not.toHaveProperty("scheduledTime");
        }
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        f.configuration.quietHours.enabled = false;
        await handle.raw.system_setting.update({ where: { key: `branch:${f.branchId}:message_automation:policy` }, data: { value: JSON.stringify(f.configuration) } });
        const admission = jest.spyOn(f.lock, "runExclusive");
        expect(await f.send()).toEqual(f.result); expect(admission).not.toHaveBeenCalled();
        expect(await handle.raw.message_log.findMany({ where: { branchId: f.branchId }, orderBy: { id: "asc" } })).toEqual(logs);
        expect(await handle.raw.message_trigger_job.findMany({ where: { branchId: f.branchId }, orderBy: { recipientPhone: "asc" } })).toEqual(jobs);
        for (const source of jobs) {
            const entity = (await f.jobs.findByIdInBranch(f.branchId, source.id))!;
            await expect(f.sms.resolveDeliverySnapshot(entity)).resolves.toMatchObject({ receiver: source.recipientPhone, message: "synthetic PG" });
        }
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("rolls back the converted PostgreSQL root and all ordinals when the last job write fails", async () => {
        let prepared!: Row; let branchId!: string;
        await expect(pgSlice({ finalDefer: true, batch: true, onPrepared: (row, jobs, branch) => {
            prepared = row; branchId = branch;
            const create = jobs.createManualSmsJob.bind(jobs); let calls = 0;
            jest.spyOn(jobs, "createManualSmsJob").mockImplementation(async (...args) => {
                const result = await create(...args);
                if (++calls === 2) throw new Error("synthetic final ordinal failure");
                return result;
            });
        } })).rejects.toThrow(ServiceUnavailableException);
        expect(await handle.raw.message_log.findMany({ where: { branchId } })).toEqual([prepared]);
        expect(await handle.raw.message_trigger_job.count({ where: { branchId } })).toBe(0);
        expect(await handle.raw.message_trigger_rule.count({ where: { branchId } })).toBe(0);
    });
    it("SQL uses the stable 08:00 anchor, initial retry-OFF selection bypasses cadence, and the real Core sends once", async () => {
        const f = await pgSlice(); const source = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        expect(source).toMatchObject({ status: "pending", attempts: 0, claimToken: null, nextAttemptAt: release });
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const selected = await f.jobs.consumeDispatchSlotsAndFindDueJobs([{ branchId: f.branchId, automaticEnabled: true, retryEnabled: true, intervalMinutes: 1440, pastExpiryHours: 1 }], release);
        expect(selected).toHaveLength(1); expect(selected[0]!.dispatchSelection).toMatchObject({ expired: false, anchor: release });
        const runtimeKey = `branch:${f.branchId}:message_automation:last_dispatch_at`; policyKeys.push(runtimeKey);
        expect(await f.jobs.consumeDispatchSlotsAndFindDueJobs([{ branchId: f.branchId, automaticEnabled: true, retryEnabled: false, intervalMinutes: 1440, pastExpiryHours: 1 }], release)).toHaveLength(0);
        expect((await f.jobs.findDueQuietQueueJobs([{ branchId: f.branchId, automaticEnabled: false, retryEnabled: false, intervalMinutes: 1440 }], release)).some(job => job.id === f.jobId)).toBe(true);
        expect((await f.jobs.findQuietHeldJobs(f.branchId))[0]!.hold.releaseAt).toEqual(release);
        await f.core.dispatchPendingJobNow(f.jobId, { expectedBranchId: f.branchId });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(await handle.raw.message_log.count({ where: { branchId: f.branchId } })).toBe(1);
        expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } })).toMatchObject({ scheduledFor: source.scheduledFor, dedupeKey: source.dedupeKey, status: "sent" });
    });
    it("filters 100 unapproved and 100 automatic-OFF holds before the cap, retains manual-OFF, and round-robins 100 eligible rows", async () => {
        const denied = await pgSlice(); const off = await pgSlice(); const first = await pgSlice(); const second = await pgSlice();
        async function copyHolds(slice: typeof first, count: number, automaticRuleId?: string) {
            const base = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: slice.jobId } });
            const log = await handle.raw.message_log.findUniqueOrThrow({ where: { id: slice.logId } });
            const jobs = Array.from({ length: count }, (_, index) => ({ ...base, id: randomUUID(),
                ruleId: automaticRuleId ?? base.ruleId, templateKey: automaticRuleId ? "INFO" : base.templateKey,
                dedupeKey: `quiet-cap:${slice.branchId}:${index}` }));
            await handle.raw.message_trigger_job.createMany({ data: jobs.map(row => ({ ...row, payload: row.payload as Prisma.InputJsonValue })) });
            const copiedLogs = await handle.raw.message_log.createManyAndReturn({ data: jobs.map((row, index) => {
                const data = log;
                return { ...data, id: undefined, triggerJobId: row.id, variables: data.variables as Prisma.InputJsonValue,
                    carrierResults: data.carrierResults === null ? Prisma.DbNull : data.carrierResults as Prisma.InputJsonValue,
                    templateKey: automaticRuleId ? "INFO" : data.templateKey,
                    providerAcceptanceKey: `quiet-cap:${slice.branchId}:${index}` };
            }), select: { id: true, triggerJobId: true } });
            // Each synthetic private job keeps its own actual acceptance FK.
            await handle.raw.$transaction(copiedLogs.map(copied => handle.raw.message_trigger_job.update({
                where: { id: copied.triggerJobId! },
                data: { payload: { ...base.payload as Prisma.InputJsonObject, existingMessageLogId: copied.id } },
            })));
        }
        const offRule = await createMessageTriggerRule(handle.raw, tracker, { branchId: off.branchId, isActive: true, templateKey: "INFO" });
        await copyHolds(denied, 100); await copyHolds(off, 100, offRule.id);
        const policies = [off, first, second].map(slice => ({ branchId: slice.branchId,
            automaticEnabled: slice !== off, retryEnabled: false, intervalMinutes: 1440 }));
        const initial = await first.jobs.findDueQuietQueueJobs(policies, release, 100);
        expect(initial.map(job => job.id).sort()).toEqual([off.jobId, first.jobId, second.jobId].sort());
        await copyHolds(first, 100); await copyHolds(second, 100);
        const capped = await first.jobs.findDueQuietQueueJobs(policies, release, 100);
        expect(capped).toHaveLength(100); expect(capped.some(job => job.id === off.jobId)).toBe(true);
        expect(capped.filter(job => job.branchId === first.branchId).length).toBeGreaterThanOrEqual(49);
        expect(capped.filter(job => job.branchId === second.branchId).length).toBeGreaterThanOrEqual(49);
        expect(capped.some(job => job.branchId === denied.branchId || job.ruleId === offRule.id)).toBe(false);
        expect(new Set(capped.map(job => job.id)).size).toBe(100);
        expect(await first.jobs.findDueQuietQueueJobs([], release)).toEqual([]);
    });
    it("the actual claim timestamp round-trips through Prisma without changing the held source", async () => {
        const f = await pgSlice();
        const source = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const deadline = new Date("2026-11-03T23:20:00.000Z");
        const token = await f.lock.runExclusive(f.branchId, tx => f.jobs.claimPendingWithRuleFence(f.jobId, f.branchId, tx, deadline));
        expect(token).toEqual(expect.any(String));
        const reloaded = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        expect(reloaded).toMatchObject({ status: "processing", claimToken: token, processingDeadlineAt: deadline });
        expect({ payload: reloaded.payload, dedupeKey: reloaded.dedupeKey, scheduledFor: reloaded.scheduledFor })
            .toEqual({ payload: source.payload, dedupeKey: source.dedupeKey, scheduledFor: source.scheduledFor });
        // Compare the stored precision directly with the Date used by the existing CAS.
        const equality = await handle.raw.$queryRaw<Array<{ exact: boolean }>>(Prisma.sql`
            SELECT updated_at = ${reloaded.updatedAt}::timestamptz AS exact
            FROM message_trigger_job
            WHERE id = ${f.jobId} AND branch_id = ${f.branchId}::uuid
        `);
        expect(equality).toEqual([{ exact: true }]);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["claim token", "deadline"])("refuses a captured claim after its %s changes without job, log, or entity writes", async fence => {
        const f = await pgSlice();
        const held = (await f.jobs.findQuietHeldJobs(f.branchId))[0]!;
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const deadline = new Date("2026-11-03T23:20:00.000Z");
        const token = await f.lock.runExclusive(f.branchId, tx => f.jobs.claimPendingWithRuleFence(f.jobId, f.branchId, tx, deadline));
        expect(token).toEqual(expect.any(String));
        const claimed = (await f.jobs.findByIdInBranch(f.branchId, f.jobId))!;
        expect(claimed).toMatchObject({ status: "processing", claimToken: token, processingDeadlineAt: deadline });
        const beforeEntity = structuredClone(claimed);
        await handle.raw.message_trigger_job.update({ where: { id: f.jobId }, data: fence === "claim token"
            ? { claimToken: randomUUID() } : { processingDeadlineAt: new Date("2026-11-03T23:21:00.000Z") } });
        const beforeJob = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } });
        const beforeLog = await handle.raw.message_log.findUniqueOrThrow({ where: { id: f.logId } });
        await expect(f.lock.runExclusive(f.branchId, tx => f.jobs.transitionQuietHold(claimed, held.logId, held.acceptanceKey,
            held.fingerprint, { action: "CANCEL", reevaluateAt: null }, held.hold.policyRevision, tx, "expired_after_quiet")))
            .rejects.toThrow("Quiet hold claim changed");
        expect(await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: f.jobId } })).toEqual(beforeJob);
        expect(await handle.raw.message_log.findUniqueOrThrow({ where: { id: f.logId } })).toEqual(beforeLog);
        expect(await handle.raw.message_trigger_job.count({ where: { branchId: f.branchId } })).toBe(1);
        expect(await handle.raw.message_log.count({ where: { branchId: f.branchId } })).toBe(1);
        expect(structuredClone(claimed)).toEqual(beforeEntity);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
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
    it("replays a final-admission CANCEL truthfully and cannot revive it after OFF", async () => {
        const f = memoryQueue();
        const reservation = { triggerType: "scheduled" as const, scheduledDate: "2026-11-04", scheduledTime: "08:00" };
        expect(await f.send(reservation)).toMatchObject({ outcome: "queued", items: [{ status: "queued" }] });
        Object.assign(f.configuration.quietHours, { start: "07:00", end: "09:00", action: "CANCEL" });
        f.configure(f.configuration);
        jest.mocked(Date.now).mockReturnValue(release.getTime());
        const id = f.tables["message_trigger_job"]![0]!["id"] as string;
        const stalePending = (await f.jobs.findByIdInBranch(f.branchId, id))!;
        await f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId });
        expect(f.tables["message_trigger_job"]![0]).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL", claimToken: null });
        expect(f.tables["message_log"]![0]).toMatchObject({ status: "failed", providerCallStartedAt: null, nextRetryAt: null,
            variables: { manualQueueStatus: "canceled", manualQueueReason: "message_quiet_hours:CANCEL" } });
        expect(await f.send(reservation)).toMatchObject({ outcome: "canceled", items: [{ status: "canceled", reason: "message_quiet_hours:CANCEL" }] });
        f.configuration.quietHours.enabled = false; f.configure(f.configuration);
        jest.spyOn(f.jobs, "findByIdInBranch").mockResolvedValueOnce(stalePending);
        await expect(f.core.dispatchPendingJobNow(id, { expectedBranchId: f.branchId })).rejects.toThrow("Invalid quiet hold association");
        expect(await f.send(reservation)).toMatchObject({ outcome: "canceled", items: [{ reason: "message_quiet_hours:CANCEL" }] });
        expect(f.tables["message_log"]).toHaveLength(1); expect(f.tables["message_trigger_job"]).toHaveLength(1);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
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
