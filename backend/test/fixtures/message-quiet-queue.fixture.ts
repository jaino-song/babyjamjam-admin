import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { MessageQuietHoursService } from "application/services/message-quiet-hours.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
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

// Run the real message services against an in-memory SQL and Prisma boundary.
type Row = Record<string, unknown>;

export function memoryQueue(templateBody?: string) {
    const branchId = "88000000-0000-4000-8000-000000000001";
    const tables: Record<string, Row[]> = { message_log: [], message_trigger_job: [], message_trigger_rule: [], message_trigger_rule_branch_override: [], system_setting: [],
        client: [{ id: 7, branchId, name: "synthetic", phone: "01000000011", deletedAt: null }], employee: [],
        message_occurrence_claim: [], message_occurrence_manual_attempt: [] };
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
            if ("equals" in predicate && JSON.stringify(actual) !== JSON.stringify(predicate["equals"])) return false;
            if ("gt" in predicate && !(actual != null && Number(actual) > Number(predicate["gt"]))) return false;
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
        count: jest.fn(async ({ where }: { where: Row }) => tables[name]!.filter(row => matches(row, where)).length),
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
            const row = tables[name]!.find(row => matches(row, (where["branchId_occurrenceKey"] as Row | undefined) ?? where));
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
        message_occurrence_claim: model("message_occurrence_claim"), message_occurrence_manual_attempt: model("message_occurrence_manual_attempt"),
        $executeRaw: jest.fn(async (input?: Prisma.Sql | TemplateStringsArray) => {
            const sql = input && "sql" in input ? input : undefined;
            if (sql && sql.sql.includes("INSERT INTO message_occurrence_claim")) {
                const [branchId, occurrenceKey, templateKey, eventType, lifecycleId, recipientKind, recipientId, slot] = sql.values;
                const claims = tables["message_occurrence_claim"]!;
                if (!claims.some(row => row["branchId"] === branchId && row["occurrenceKey"] === occurrenceKey)) {
                    claims.push({ branchId, occurrenceKey, templateKey, eventType, lifecycleId, recipientKind, recipientId, slot, state: "released", holderLogId: null });
                }
            }
            return 1;
        }),
        $transaction: jest.fn(async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
            expect(active).toBe(false); active = true;
            const snapshot = structuredClone(tables);
            try { const result = await work(db as never); if (commitFailure) throw new Error("late commit failure"); return result; }
            catch (error) { for (const key of Object.keys(tables)) tables[key] = snapshot[key]!; throw error; }
            finally { active = false; }
        }),
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            if (sql.sql.includes("FROM message_occurrence_claim")) {
                return tables["message_occurrence_claim"]!.filter(row => row["branchId"] === sql.values[0] && row["occurrenceKey"] === sql.values[1])
                    .map(row => ({ occurrence_key: row["occurrenceKey"], state: row["state"], holder_log_id: row["holderLogId"] }));
            }
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
    const templates = { findByKey: jest.fn(() => { throw new Error("Automatic renderer must not run"); }),
        getByKeyForBranch: async () => {
            if (templateBody === undefined) throw new Error("Automatic renderer must not run");
            return { id: "fixture-template", content: templateBody, updatedAt: new Date(0) };
        } };
    const aligo = { sendSms: jest.fn(async (request: Row) => {
        expect(active).toBe(false);
        return { request, response: { result_code: 1, message: "accepted", msg_id: 91, success_cnt: 1, error_cnt: 0 } };
    }) };
    const sender = { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) };
    const gate = new AgentAutomationDeliveryGateService(db as never, lock,
        { checkAutomaticJob: async () => ({ status: "legacy" }) } as never);
    const sms = new SmsTriggerDeliveryService(aligo as never, templates as never, logs, new SmsProviderAcceptanceService(logs), undefined, gate,
        undefined, settings, undefined, quiet, jobs, sender as never);
    const acceptance = new SmsProviderAcceptanceService(logs);
    const activation = new MessageAutomationActivationService(db as never, lock, {} as never);
    const retry = new SmsRetryService(logs, aligo as never, approval as never, acceptance, activation, undefined, sms, jobs, undefined, settings, quiet, sender as never);
    const rules = { findByIdIncludingGlobal: async () => null };
    const core = new MessageTriggerService(db as never, new MessageTriggerDeliveryService(sms), approval as never, rules as never, jobs, logs,
        templates as never, {} as never, settings, undefined, activation, lock, undefined, gate);
    const controller = new MessageDeliveryController(aligo as never, approval as never, db as never, duplicates, quiet, jobs, sender as never);
    const send = (extra = {}) => controller.sendSms({ branchId }, { receiver: "01000000011", message: "  synthetic {{literal}}\n", idempotencyKey: "body-key", ...extra }, "ignored-header");
    return { branchId, db, tables, jobs, logs, settings, lock, core, sms, retry, controller, configuration, send, aligo, templates, approval, acceptance, activation, sender, quiet,
        newDuplicates: () => { duplicateMatches = [{ id: 999, sentAt: new Date(Date.now()) }]; },
        configure: (draft: typeof configuration) => { tables["system_setting"]![0]!["value"] = JSON.stringify(draft); },
        afterPrepared: (hook: (row: Row) => void) => { afterPrepared = hook; },
        commitFailure: () => { commitFailure = true; }, logCasFailure: () => { logCasFailure = true; } };
}
