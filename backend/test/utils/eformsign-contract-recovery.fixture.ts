import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { matchesWhere } from "./prisma-where-evaluator";
import { SbEformsignContractRecoveryRepository } from "infrastructure/database/repositories/sb.eformsign-contract-recovery.repository";
import { EformsignDocumentJobManualRecoveryService } from "application/services/eformsign-document-job-manual-recovery.service";
export const B = "11111111-1111-4111-8111-111111111111", J = "22222222-2222-4222-8222-222222222222", G = "33333333-3333-4333-8333-333333333333";
export const L = "44444444-4444-4444-8444-444444444444", I = "55555555-5555-4555-8555-555555555555", U = "77777777-7777-4777-8777-777777777777";
export const worker = { jobId: J, leaseToken: L, contractGeneration: G }, principal = { branchId: B, userId: U, branchRole: "manager" };
export const data = { customerName: "Fixture", customerContact: "01012345678", caretaker1Contact: "01098765432", area: "", customerDOB: "19900101", customerAddress: "Fixture address", caretaker1Name: "Provider", type: "general", days: "10",
    contractDuration: "10", startYear: "2026", startMonth: "11", startDay: "01", startDate: "2026-11-01", endYear: "2026", endMonth: "11", endDay: "10", endDate: "2026-11-10",
    paymentYear: "2026", paymentMonth: "11", paymentDay: "01", fullPrice: "100", grant: "0", actualPrice: "100" };
export const workflowPlan = { templateId: "template_ABC", steps: [{ seq: "1", type: "write", stepGroup: 0 }, { seq: "2", type: "participant", stepGroup: 1 }, { seq: "3", type: "reviewer", stepGroup: 2 }, { seq: "4", type: "complete", stepGroup: 3 }], recipients: [{ seq: "2", type: "participant", identity: "customer" }, { seq: "3", type: "reviewer", identity: "institution" }] };
const payload = { clientId: 2, contractData: data };
const canonical = (value: any): string => value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
export const F = createHash("sha256").update(canonical(payload)).digest("hex");
export const intentFingerprint = createHash("sha256").update(JSON.stringify({ contractData: data, generation: "prior-doc" })).digest("hex");
export const businessKey = createHash("sha256").update([B, 2, 11, 9, "-", "create", "prior-doc"].join("|")).digest("hex");
export const intentInput = { branchId: B, clientId: 2, action: "create" as const, generation: "prior-doc", localDocumentId: 11, assignmentId: 9, templateId: null, businessKey, fingerprint: intentFingerprint };
const names: Record<string, string> = { branch_id: "branchId", client_id: "clientId", creation_job_id: "creationJobId", prior_document_id: "priorDocumentId", provider_document_id: "providerDocumentId", creation_intent_id: "creationIntentId", draft_intent_id: "draftIntentId", human_intent_id: "humanIntentId", claim_epoch: "claimEpoch", claim_user_id: "claimUserId", claim_expires_at: "claimExpiresAt", contract_generation: "contractGeneration", payload_fingerprint: "payloadFingerprint", job_type: "jobType", request_key: "requestKey", active_key: "activeKey", document_id: "documentId" };
const snake = (row: any) => Object.fromEntries(Object.entries(row).map(([key, value]) => [Object.keys(names).find(name => names[name] === key) ?? key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`), value]));
export function runtimeFixture() {
    const now = new Date(), events: string[] = [], sql: Prisma.Sql[] = [];
    const state: any = {
        jobs: [{ id: J, branchId: B, clientId: 2, jobType: "create_document", source: "staff", requestKey: "request", activeKey: "active", payload: structuredClone(payload), payloadFingerprint: F,
            contractGeneration: G, leaseToken: L, status: "processing", createdAt: now, updatedAt: now, completedAt: null, heartbeatAt: now, nextAttemptAt: now, attempts: 0, progressDetail: null, progressStep: "queued", documentId: null }],
        clients: [{ id: 2, branchId: B, eDocId: "prior-doc", serviceStatus: "active", deletedAt: null }],
        authorities: [{ branchId: B, clientId: 2, generation: G, creationJobId: J, fingerprint: F, priorDocumentId: "prior-doc", providerDocumentId: null,
            creationIntentId: null, draftIntentId: null, humanIntentId: null, phase: "reserved", claimEpoch: 0n, claimUserId: null, claimExpiresAt: null }],
        intents: [{ ...intentInput, id: I, providerDocumentId: null, status: "prepared", attemptCount: 0, startedAt: null, providerAcceptedAt: null,
            uncertainAt: null, uncertainReason: null, providerReceipt: null, reconciledAt: null, reconciledOutcome: null, reconciledByUserId: null, reconciliationReason: null, createdAt: now, updatedAt: now }],
        docs: [{ id: 11, documentId: "prior-doc", branchId: B, clientId: 2, statusType: "003", createdDate: new Date(now.getTime() - 1000), updatedDate: now, permanentPurgeRequestedAt: null, voidedAt: null }],
    };
    const flags = { casZero: false, jobZero: false, insertZero: false };
    const emptyIntent = { ...structuredClone(state.intents[0]), localDocumentId: null, assignmentId: null, templateId: null, providerDocumentId: null };
    const emptyJob = structuredClone(state.jobs[0]);
    const normalize = (value: any) => value === Prisma.DbNull || value === Prisma.JsonNull ? null : value;
    const change = (row: any, values: any) => { for (const [key, value] of Object.entries(values)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : normalize(value); };
    const rows = (table: string, where: any = {}) => state[table].filter((row: any) => where.branchId_clientId ? row.branchId === where.branchId_clientId.branchId && row.clientId === where.branchId_clientId.clientId : matchesWhere(row, where));
    const model = (table: string) => ({
        findUnique: jest.fn(async ({ where }) => structuredClone(rows(table, where)[0] ?? null)),
        findFirst: jest.fn(async ({ where = {} }) => structuredClone(rows(table, where).sort((a: any, b: any) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null)),
        findMany: jest.fn(async ({ where = {} } = {}) => structuredClone(rows(table, where))),
        create: jest.fn(async ({ data }) => { events.push(`${table}.create`); const row = { ...emptyIntent, ...data, id: table === "intents" ? randomUUID() : 22 }; state[table].push(row); return structuredClone(row); }),
        update: jest.fn(async ({ where, data }) => { const row = rows(table, where)[0]; if (!row) throw new Error("missing fixture row"); events.push(`${table}.update`); change(row, data); return structuredClone(row); }),
        updateMany: jest.fn(async ({ where, data }) => { if (table === "jobs" && flags.jobZero) return { count: 0 }; const selected = rows(table, where); if (selected.length) events.push(`${table}.updateMany`); selected.forEach((row: any) => change(row, data)); return { count: selected.length }; }),
        upsert: jest.fn(async ({ where, create, update }) => { let row = rows(table, where)[0]; if (!row) { row = { id: 22, permanentPurgeRequestedAt: null, voidedAt: null, ...create }; state[table].push(row); events.push(`${table}.insert`); } else change(row, update); return structuredClone(row); }),
    });
    const tx: any = { client: model("clients"), eformsign_document_job: model("jobs"), eformsign_dispatch_intent: model("intents"), eformsign_contract_authority: model("authorities"), eformsign_doc: model("docs"),
        employee_schedule: { findFirst: jest.fn().mockResolvedValue({ id: 9, terminatedAt: null, primaryEmployee: { phone: data.caretaker1Contact, branchId: B, deletedAt: null } }) },
        doc_template: { findFirst: jest.fn().mockResolvedValue(null) } };
    tx.$queryRaw = jest.fn(async (input: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
        const query = Array.isArray(input) ? Prisma.sql(input as TemplateStringsArray, ...values) : input as Prisma.Sql; sql.push(query);
        const text = query.text.replace(/"/g, ""), ids = query.values.filter(value => typeof value === "number");
        if (/UPDATE eformsign_document_job SET status =/.test(text)) {
            const row = state.jobs.find((job: any) => query.values.includes(job.id) && query.values.includes(job.leaseToken));
            if (!row || !["processing", "reconciling"].includes(row.status)) return [];
            Object.assign(row, { status: query.values[0], lastErrorCode: query.values[1], completedAt: new Date(), heartbeatAt: null, leaseToken: null });
            events.push("jobs.terminal"); return [snake(row)];
        }
        if (/INSERT INTO eformsign_document_job/.test(text)) {
            if (flags.insertZero) return [];
            const columns = text.match(/eformsign_document_job\s*\(([^)]+)\)/)![1]!.split(",").map(value => value.trim());
            const entries = text.match(/VALUES\s*\(([\s\S]*?)\)\s*ON CONFLICT/)![1]!.split(",").map(value => value.trim());
            const row: any = { ...emptyJob, id: "88888888-8888-4888-8888-888888888888", status: "queued", attempts: 0, leaseToken: null, completedAt: null };
            columns.forEach((column, index) => { const parameter = entries[index]!.match(/\$(\d+)/); let value = parameter ? query.values[Number(parameter[1]) - 1] : entries[index]!.replace(/'/g, ""); if (column === "payload") value = JSON.parse(value as string); row[names[column] ?? column] = value; });
            state.jobs.push(row); events.push("jobs.insert"); return [snake(row)];
        }
        if (/INSERT INTO eformsign_contract_authority/.test(text)) {
            if (!text.includes("'reserved'")) throw new Error("reservation must start reserved");
            const [branchId, clientId, generation, creationJobId, fingerprint, priorDocumentId] = query.values;
            const row = { branchId, clientId, generation, creationJobId, fingerprint, priorDocumentId, providerDocumentId: null,
                creationIntentId: null, draftIntentId: null, humanIntentId: null, phase: "reserved", claimEpoch: 0n, claimUserId: null, claimExpiresAt: null };
            state.authorities.push(row); events.push("authority.insert"); return [snake(row)];
        }
        if (/UPDATE eformsign_contract_authority/.test(text)) {
            const row = state.authorities[0];
            if (row.phase !== "closed") throw new Error("rotation must require closed");
            Object.assign(row, { generation: query.values[0], creationJobId: query.values[1], fingerprint: query.values[2], priorDocumentId: query.values[3],
                providerDocumentId: null, creationIntentId: null, draftIntentId: null, humanIntentId: null, phase: "reserved", claimEpoch: 0n, claimUserId: null, claimExpiresAt: null });
            events.push("authority.rotate"); return [snake(row)];
        }
        if (text.includes("SELECT EXISTS (SELECT 1 FROM eformsign_contract_authority WHERE branch_id <>")) {
            const documents = query.values.filter(value => typeof value === "string" && value !== query.values[0]);
            return [{ conflict: state.authorities.some((row: any) => row.branchId !== query.values[0] && documents.includes(row.providerDocumentId)) || state.clients.some((row: any) => row.branchId !== query.values[0] && documents.includes(row.eDocId)) || state.docs.some((row: any) => row.branchId !== null && row.branchId !== query.values[0] && documents.includes(row.documentId)) }];
        }
        if (text.includes("SELECT EXISTS") && text.includes("e_doc_id")) return [{ conflict: state.clients.some((row: any) => row.eDocId === query.values[0] && (row.id !== query.values[1] || row.branchId !== query.values[2])) || state.authorities.some((row: any) => row.providerDocumentId === query.values[0] && row.branchId !== query.values[2]) }];
        if (/FROM client\b/.test(text)) return state.clients.filter((row: any) => !ids.length || ids.includes(row.id)).sort((a: any, b: any) => a.id - b.id).map((row: any) => ({ id: row.id, e_doc_id: row.eDocId }));
        if (/FROM eformsign_contract_authority/.test(text)) return state.authorities.filter((row: any) => !ids.length || ids.includes(row.clientId)).map(snake);
        if (/FROM eformsign_document_job/.test(text) && /request_key|active_key/.test(text)) return state.jobs.filter((row: any) => query.values.includes(row.requestKey) || query.values.includes(row.activeKey)).map(snake);
        if (/FROM eformsign_document_job/.test(text)) return state.jobs.filter((row: any) => query.values.includes(row.id)).map(snake);
        if (/FROM eformsign_dispatch_intent/.test(text)) return state.intents.filter((row: any) => query.values.includes(row.id)).map((row: any) => ({ id: row.id }));
        if (/FROM eformsign_doc\b/.test(text)) return state.docs.filter((row: any) => query.values.includes(row.documentId)).map((row: any) => ({ id: row.id }));
        throw new Error(`Unexpected query: ${text}`);
    });
    tx.$executeRaw = jest.fn(async (query: Prisma.Sql) => {
        sql.push(query); if (!query.text.includes("UPDATE eformsign_contract_authority")) throw new Error("unexpected write");
        if (flags.casZero) return 0;
        const value = (column: string) => { const match = query.text.match(new RegExp(`(?:WHERE|AND) ${column} = \\$(\\d+)`)); if (!match) throw new Error(`missing CAS equality ${column}`); return query.values[Number(match[1]) - 1]; };
        const current = state.authorities.find((row: any) => ["branch_id", "client_id", "generation", "creation_job_id", "phase", "claim_epoch"].every(column => row[names[column] ?? column] === value(column)));
        if (!current) return 0;
        const fingerprint = query.text.match(/AND fingerprint = \$(\d+)/);
        if (fingerprint && current.fingerprint !== query.values[Number(fingerprint[1]) - 1]) return 0;
        const claimant = query.text.match(/claim_user_id IS NOT DISTINCT FROM \$(\d+)/); if (claimant && current.claimUserId !== query.values[Number(claimant[1]) - 1]) return 0;
        events.push("authority.cas");
        const assignments = query.text.split("WHERE")[0]!;
        for (const match of assignments.matchAll(/([a-z_]+) = \$(\d+)/g)) current[names[match[1]!] ?? match[1]!] = query.values[Number(match[2]) - 1];
        return 1;
    });
    const prisma: any = { ...tx, $transaction: jest.fn(async (run: any) => { const before = structuredClone(state); try { return await run(tx); } catch (error) { Object.assign(state, before); throw error; } }) };
    const options: any = { getConfiguredContractIdentity: jest.fn(() => ({ companyId: "company-abc", creatorId: "service@example.test" })), resolveEffectiveTemplateId: jest.fn((template?: string) => template ?? "template_ABC"), generateDocumentOptions: jest.fn((_data, access, refresh, template = "template_ABC") => ({
        company: { id: "company-abc" }, user: { id: "service@example.test", type: "01", access_token: access, refresh_token: refresh }, mode: { type: "01", template_id: template } })) };
    const workflow = { form_id: "template_ABC", config: { step_settings: [{ seq: 1, type: "write", step_group: 0 }, { seq: 2, type: "participant", step_group: 1 }, { seq: 3, type: "reviewer", step_group: 2 }, { seq: 4, type: "complete", step_group: 3 }] } };
    const remote: any = { id: "bound-doc", template: { id: "template_ABC" }, creator: { id: "service@example.test", recipient_type: "01" }, created_date: Date.now(), updated_date: Date.now(),
        current_status: { status_type: "001", step_type: "00", step_index: "1", step_group: 0, step_name: "write", expired_date: 0 } };
    const provider: any = { getTemplateWorkflowConfig: jest.fn(async () => structuredClone(workflow)), getDocument: jest.fn(async () => structuredClone(remote)) };
    const credentials: any = { withCredentials: jest.fn(async (_principal, _capability, run) => run({ accessToken: "PRIVATE_ACCESS", refreshToken: "PRIVATE_REFRESH" })) };
    const draft: any = { dispatchDraft: jest.fn(async (params) => { events.push("draft.beforeOpen"); if (!await params.beforeOpen()) return { ok: false, uncertain: false, reason: "open-denied", durationMs: 0 }; events.push("draft.sdk"); return { ok: true, candidateDocumentId: "bound-doc", durationMs: 1 }; }) };
    const repository = new SbEformsignContractRecoveryRepository(prisma, options);
    const snapshots = { bumpVersion: jest.fn().mockResolvedValue(1) };
    const service = new EformsignDocumentJobManualRecoveryService(repository, draft, credentials, options, { findByArea: jest.fn().mockResolvedValue(null) } as never, provider, snapshots as never);
    function manual() { state.jobs[0].status = "failed"; state.jobs[0].leaseToken = null; state.jobs[0].completedAt = now; state.authorities[0].creationIntentId = I; Object.assign(state.intents[0], { status: "reconciled_not_delivered", reconciledOutcome: "not_delivered", reconciledAt: now, reconciledByUserId: U });
        state.jobs[0].payload.contractDispatch = { ...intentInput, effectiveTemplateId: "template_ABC", companyId: "company-abc", creatorId: "service@example.test", workflow: workflowPlan };
    }
    function forward() { Object.assign(remote.current_status, { status_type: "060", step_type: "05", step_index: "2", step_group: 1 }); }
    return { state, tx, prisma, options, repository, service, draft, provider, credentials, remote, events, sql, flags, manual, forward, snapshots };
}
