import { AgentAutomationJobAuthorityService, type CanonicalAutomationRenderer } from "application/services/agent-automation-job-authority.service";
import { buildClientMessageRecipe, type ClientTriggerSource } from "application/services/message-trigger-recipes";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { ClientAutomationImpactService } from "application/services/client-automation-impact.service";
import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationRecordStoreService, agentAutomationTaskCommitReference } from "application/agent/agent-automation-record-store.service";
import { agentAutomationCoverageRecordDigest, agentAutomationCoverageScope, agentAutomationGrandfatheredFingerprint } from "application/agent/agent-automation-coverage";
import type { AgentAutomationCoverage, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SERVICE_END_NOTICE_DEFAULT_CONTENT, SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

/**
 * BJJ-342: SERVICE_END_NOTICE branch-rule jobs must reach the normal automatic
 * authority path instead of being refused early as manual, while jobs against
 * the branchless system manual row must still short-circuit before authority
 * is ever consulted.
 */
describe("AgentAutomationJobAuthorityService.checkAutomaticJob ownership gate", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const branchRuleId = "30000000-0000-4000-8000-000000009999";
    const jobId = "40000000-0000-4000-8000-000000009999";

    const buildScheduledBranchJob = () => MessageTriggerJobEntity.reconstitute(
        jobId,
        branchId,
        branchRuleId,
        "pending",
        new Date("2026-09-16T03:00:00.000Z"),
        null,
        null,
        null,
        42,
        null,
        MessageTriggerRecipientType.CLIENT,
        "010-1234-5678",
        MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        // No :manual: marker: this is the buildClientMessageRecipe dedupe shape
        // for a scheduled branch-rule job, not a manual-send job.
        `${branchRuleId}:client:42:CLIENT:2026-09-16T03:00:00.000Z`,
        { memberId: "client:42", recipientName: "김산모", recipientPhone: "010-1234-5678", templateVariables: {} },
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
    );

    const buildManualSystemRowJob = () => MessageTriggerJobEntity.reconstitute(
        jobId,
        branchId,
        SERVICE_END_NOTICE_RULE_ID,
        "pending",
        new Date("2026-09-16T03:00:00.000Z"),
        null,
        null,
        null,
        42,
        null,
        MessageTriggerRecipientType.CLIENT,
        "010-1234-5678",
        MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        `${SERVICE_END_NOTICE_RULE_ID}:client:42:manual:11111111-1111-4111-8111-111111111111`,
        { memberId: "client:42", recipientName: "김산모", recipientPhone: "010-1234-5678", templateVariables: {} },
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
    );

    const buildService = (checkImpl: jest.Mock) => {
        const authority = { check: checkImpl };
        const sources = {};
        const sender = {};
        const service = new AgentAutomationJobAuthorityService(
            authority as never,
            sources as never,
            sender as never,
        );
        return { service, authority };
    };

    const render = jest.fn();

    it("does not refuse a scheduled SERVICE_END_NOTICE branch-rule job as manual — it reaches the normal automatic authority path", async () => {
        const job = buildScheduledBranchJob();
        const transaction = {
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(job) },
        };
        const authorized = { status: "allowed", seal: { version: 1 } };
        const check = jest.fn().mockResolvedValue(authorized);
        const { service, authority } = buildService(check);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(authority.check).toHaveBeenCalledTimes(1);
        const [, input] = authority.check.mock.calls[0]!;
        expect(input.target).toEqual(expect.objectContaining({
            branchId, clientId: 42, kind: "client-rule", ruleId: branchRuleId, scheduleId: null, recipientType: "client",
        }));
        // Pass-through: the ownership gate did not intercept the call with its own refusal.
        expect(result).toBe(authorized);
    });

    it("is refused via the normal authority path (not the manual short-circuit) when authority is not bound", async () => {
        const job = buildScheduledBranchJob();
        const transaction = {
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(job) },
        };
        const refused = { status: "refused", reason: "automation-consent-denied" };
        const check = jest.fn().mockResolvedValue(refused);
        const { service, authority } = buildService(check);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(authority.check).toHaveBeenCalledTimes(1);
        expect(result).toBe(refused);
    });

    it("still refuses a manual SERVICE_END_NOTICE job against the system row before ever consulting authority", async () => {
        const job = buildManualSystemRowJob();
        const transaction = {
            message_trigger_job: { findFirst: jest.fn() },
        };
        const check = jest.fn();
        const { service, authority } = buildService(check);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(authority.check).not.toHaveBeenCalled();
        expect(transaction.message_trigger_job.findFirst).not.toHaveBeenCalled();
        expect(result).toEqual({ status: "refused", reason: "automation-authority-unavailable" });
    });
});

/**
 * BJJ-342 M1: the "grandfathered" comparison inside `describeCurrentClientEffect`
 * compares the job's (enriched) source payload against the fresh
 * `buildClientMessageRecipe` payload, which never contains a receipt link. An
 * enriched SERVICE_END_NOTICE job must still match its recipe now that the
 * enricher-owned fields are excluded from the bound source payload.
 *
 * Re-audit (2026-09-23) found the FIRST version of this test suite gave a
 * false pass: it mocked `render` to return a canned snapshot, so it never
 * exercised the real `SmsTriggerDeliveryService.resolveCanonicalDeliverySnapshot`
 * render, which throws `MissingSmsTemplateVariablesError` for a SERVICE_END_NOTICE
 * job/recipe missing `receiptUrl` (a required system-template variable --
 * domain/constants/system-template-registry.ts). This version renders through
 * the REAL delivery service (only the system-template CONTENT lookup is
 * stubbed) so it actually proves the placeholder-substitution fix in
 * `AgentAutomationJobAuthorityService.withServiceEndNoticePreviewLink` works
 * end-to-end, at both materialize (job has no receiptUrl yet) and dispatch
 * (job carries the enricher's real link).
 */
describe("AgentAutomationJobAuthorityService.checkAutomaticJob grandfathered comparison for SERVICE_END_NOTICE (BJJ-342 M1)", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const ruleId = "50000000-0000-4000-8000-000000005555";
    const jobId = "40000000-0000-4000-8000-000000009999";
    const clientId = 42;
    const clientIdentity = "d".repeat(64);

    const client: ClientTriggerSource = {
        id: clientId,
        name: "김산모",
        phone: "01012345678",
        type: null,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-09-01T00:00:00.000Z"),
        serviceEndNoticeSentAt: null,
    };

    const rule = MessageTriggerRuleEntity.reconstitute(
        ruleId,
        branchId,
        "서비스 종료 안내",
        true,
        MessageTriggerEventType.SERVICE_END,
        MessageTriggerOffsetType.SAME_DAY,
        0,
        MessageTriggerRecipientType.CLIENT,
        MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
    );

    // The real recipe builder is the source of truth for scheduledFor/dedupeKey math
    // (KST calendar offsets); deriving the job's fields from it keeps this test from
    // having to reimplement that math and guarantees internal consistency.
    const recipe = buildClientMessageRecipe(rule, client, new Date("2026-09-01T00:00:00.000Z"));
    if (!recipe) throw new Error("test setup: recipe must build");

    /** The freshly materialized job, exactly as `buildClientMessageRecipe` built it -- no receiptUrl/buttonUrl yet. */
    function buildUnenrichedJob(): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            jobId,
            branchId,
            ruleId,
            "processing",
            recipe!.scheduledFor,
            null,
            null,
            null,
            clientId,
            null,
            MessageTriggerRecipientType.CLIENT,
            recipe!.recipientPhone ?? null,
            MessageTriggerTemplateKey.SERVICE_END_NOTICE,
            recipe!.dedupeKey,
            { ...recipe!.payload },
            new Date("2026-06-01T00:00:00.000Z"),
            new Date("2026-06-01T00:00:00.000Z"),
        );
    }

    /** ReceiptLinkDeliveryEnricher's real mutation applied on top of the same job. */
    function enrich(job: MessageTriggerJobEntity): MessageTriggerJobEntity {
        return job.withPayloadOverride({
            templateVariables: { ...job.payload.templateVariables, receiptUrl: "https://example.test/receipt/efr_abc123" },
            buttonUrl: "https://example.test/receipt/efr_abc123",
        });
    }

    const settings = {
        status: "available" as const,
        rules: [rule],
        defaultsPresent: true,
        dispatchEnabled: true,
        senderApproved: true,
        senderApprovedAt: new Date("2026-01-01T00:00:00.000Z"),
        pastTriggerEnabled: false,
        pastTriggerConfig: { sendIntervalMinutes: 10 },
    };

    /** Real SmsTriggerDeliveryService; only the DB-backed template content lookup is stubbed. */
    function buildRealRender(): { render: CanonicalAutomationRenderer; getByKeyForBranch: jest.Mock } {
        const getByKeyForBranch = jest.fn().mockResolvedValue({ content: SERVICE_END_NOTICE_DEFAULT_CONTENT });
        const systemTemplateService = { getByKeyForBranch };
        const delivery = new SmsTriggerDeliveryService(
            {} as never,
            systemTemplateService as never,
            {} as never,
        );
        const render: CanonicalAutomationRenderer = (job, transaction) => delivery.resolveCanonicalDeliverySnapshot(job, transaction);
        return { render, getByKeyForBranch };
    }

    /**
     * A minimal stand-in for `AgentAutomationAuthorityService.check` that
     * models the "no exact authority row, matching grandfathered coverage"
     * branch: it always calls the real `describe` callback (so the real
     * render always runs) and translates a non-null effect into "allowed".
     * `AgentAutomationAuthorityService.check` itself is exercised by its own
     * unit tests; the full lineage/coverage plumbing is out of scope here --
     * this suite's job is proving the render/comparison path, not re-testing
     * the coverage resolver.
     */
    function buildService(job: MessageTriggerJobEntity, render: CanonicalAutomationRenderer) {
        const check = jest.fn(async (_tx: unknown, input: { target: unknown }, describe: (arg: unknown) => Promise<unknown>) => {
            const effect = await describe({
                scope: { ...(input.target as object), clientIdentity, scheduleIdentity: null },
                subject: { kind: "client", clientId, clientIdentity },
                change: "create",
            });
            return effect
                ? { status: "allowed", seal: { version: 1 } }
                : { status: "refused", reason: "automation-consent-denied" };
        });
        const sources = {
            readClientAutomationSettings: jest.fn().mockResolvedValue(settings),
            readClientAutomationSource: jest.fn().mockResolvedValue(client),
        };
        const sender = { read: jest.fn().mockReturnValue({ availability: "available", identityDigest: "e".repeat(64) }) };
        const service = new AgentAutomationJobAuthorityService({ check } as never, sources as never, sender as never);
        const transaction = { message_trigger_job: { findFirst: jest.fn().mockResolvedValue(job) } };
        return { service, transaction, render };
    }

    it("is allowed at materialize time, before the receipt link exists, using the real renderer", async () => {
        const job = buildUnenrichedJob();
        const { render, getByKeyForBranch } = buildRealRender();
        const { service, transaction } = buildService(job, render);

        const result = await service.checkAutomaticJob(transaction as never, job, "materialize", render);

        expect(result).toEqual({ status: "allowed", seal: { version: 1 } });
        expect(getByKeyForBranch).toHaveBeenCalled();
    });

    it("is allowed at dispatch time, after ReceiptLinkDeliveryEnricher has written the real link, using the real renderer", async () => {
        const job = enrich(buildUnenrichedJob());
        const { render } = buildRealRender();
        const { service, transaction } = buildService(job, render);

        const result = await service.checkAutomaticJob(transaction as never, job, "dispatch", render, undefined);

        expect(result).toEqual({ status: "allowed", seal: { version: 1 } });
    });

    it("control: tampering a non-link field (name) after enrichment is still refused with the real renderer", async () => {
        const job = enrich(buildUnenrichedJob());
        job.payload.templateVariables["name"] = "다른이름";
        const { render } = buildRealRender();
        const { service, transaction } = buildService(job, render);

        const result = await service.checkAutomaticJob(transaction as never, job, "dispatch", render, undefined);

        expect(result).toEqual({ status: "refused", reason: "automation-consent-denied" });
    });

    it("sanity: rendering the un-enriched job WITHOUT the placeholder substitution throws (proves the fix is load-bearing)", async () => {
        const job = buildUnenrichedJob();
        const { render } = buildRealRender();
        await expect(render(job, {} as never)).rejects.toThrow(/receiptUrl/);
    });
});

/**
 * BJJ-342 M1 MINOR-2 (third audit, 2026-09-23): the two describe blocks above
 * still stub `AgentAutomationAuthorityService.check` with a fake that always
 * consults `describe` and translates any non-null effect into "allowed", and
 * neither test ever supplies `preparedSnapshotHash`. That proves the render
 * path in isolation, but not that a REAL grandfathered coverage record (as
 * `ClientAutomationImpactService.planClientWrite` actually produces for an
 * agent client write) survives the REAL `AgentAutomationAuthorityService.check`
 * end to end. This block wires the real authority service (only its record
 * store and the Prisma calls it makes are stubbed) and a real
 * `ClientAutomationImpactService` (only its source/jobs/sender collaborators
 * are stubbed) together with the real renderer used above.
 */
describe("Real AgentAutomationAuthorityService + real ClientAutomationImpactService chain for SERVICE_END_NOTICE (BJJ-342 M1 MINOR-2)", () => {
    const branchId = "20000000-0000-4000-8000-000000009161";
    const ruleId = "50000000-0000-4000-8000-000000005555";
    const jobId = "40000000-0000-4000-8000-000000009999";
    const clientId = 42;
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: clientId, createdAt: createdAt.toISOString() });

    // endDate is in the future relative to "now" (real Date.now(), well past
    // 2026-09-23) so a fresh CREATE recipe schedules ahead of now and a
    // grandfathered UPDATE recipe still builds successfully.
    const before: ClientTriggerSource = {
        id: clientId, name: "김산모", phone: "01012345678", type: null, createdAt,
        startDate: new Date("2026-01-01T00:00:00.000Z"), endDate: new Date("2027-06-01T00:00:00.000Z"),
        serviceEndNoticeSentAt: null,
    };

    const rule = MessageTriggerRuleEntity.reconstitute(
        ruleId, branchId, "서비스 종료 안내", true,
        MessageTriggerEventType.SERVICE_END, MessageTriggerOffsetType.SAME_DAY, 0,
        MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.SERVICE_END_NOTICE,
        new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"),
    );

    const settings = {
        status: "available" as const, rules: [rule], defaultsPresent: true,
        dispatchEnabled: true, senderApproved: true, senderApprovedAt: new Date("2026-01-01T00:00:00.000Z"),
        pastTriggerEnabled: false, pastTriggerConfig: { sendIntervalMinutes: 10 },
    };
    const senderRead = { availability: "available" as const, identityDigest: "e".repeat(64) };

    function buildRealDelivery(): SmsTriggerDeliveryService {
        return new SmsTriggerDeliveryService(
            {} as never,
            { getByKeyForBranch: jest.fn().mockResolvedValue({ content: SERVICE_END_NOTICE_DEFAULT_CONTENT }) } as never,
            {} as never,
        );
    }

    /** Real ClientAutomationImpactService; only source/jobs/sender collaborators are stubbed. */
    function buildImpactService(): ClientAutomationImpactService {
        const sources = {
            readClientAutomationSettings: jest.fn().mockResolvedValue(settings),
            readClientAutomationSource: jest.fn().mockResolvedValue(before),
            readClientAutomationArea: jest.fn(),
            readClientAutomationSchedules: jest.fn().mockResolvedValue([]),
            readClientAutomationServiceRecordLinks: jest.fn().mockResolvedValue([]),
        };
        const jobs = { findForClientAutomationReview: jest.fn().mockResolvedValue([]) };
        const sender = { read: jest.fn().mockReturnValue(senderRead) };
        return new ClientAutomationImpactService(sources as never, buildRealDelivery(), sender as never, jobs as never);
    }

    /** The recipe-derived job the authority side must reconstruct and compare against (see describeCurrentClientEffect). */
    const recipe = buildClientMessageRecipe(rule, before, new Date("2026-09-01T00:00:00.000Z"));
    if (!recipe) throw new Error("test setup: recipe must build");

    function buildUnenrichedJob(fromRecipe = recipe!): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            jobId, branchId, ruleId, "processing", fromRecipe.scheduledFor, null, null, null,
            clientId, null, MessageTriggerRecipientType.CLIENT, fromRecipe.recipientPhone ?? null,
            MessageTriggerTemplateKey.SERVICE_END_NOTICE, fromRecipe.dedupeKey, { ...fromRecipe.payload },
            new Date("2026-06-01T00:00:00.000Z"), new Date("2026-06-01T00:00:00.000Z"),
        );
    }

    function enrich(job: MessageTriggerJobEntity, link: string): MessageTriggerJobEntity {
        return job.withPayloadOverride({
            templateVariables: { ...job.payload.templateVariables, receiptUrl: link },
            buttonUrl: link,
        });
    }

    /**
     * Builds a task-origin coverage record whose sole grandfathered member is
     * `effect`, plus the matching `AgentAutomationTaskCommitReference` a
     * SERVICE_END_NOTICE job would carry in `payload.taskAutomationReference`
     * after that same task committed. Mirrors the pattern proven in
     * `agent-automation-authority.service.spec.ts`.
     */
    function buildCoverageAndReference(effect: import("domain/entities/agent-automation-consent").AgentAutomationEffect) {
        const scope: AgentAutomationScope = {
            branchId, clientId, clientIdentity, kind: "client-rule", ruleId,
            scheduleId: null, scheduleIdentity: null, recipientType: "client",
        };
        const origin = {
            kind: "task" as const,
            userId: "88000000-0000-4000-8000-000000000002",
            actionId: "88000000-0000-4000-8000-000000000003",
            taskId: "88000000-0000-4000-8000-000000000004",
            taskRevision: 1,
            consentEventId: null,
        };
        const record: AgentAutomationCoverage = {
            kind: "coverage", version: 1, id: "88000000-0000-4000-8000-000000000005",
            scope: agentAutomationCoverageScope(scope), sequence: 1, previousId: null, origin,
            mutationDigest: agentBindingHash("mutation"),
            grandfatheredScopes: [{ scope, fingerprint: agentAutomationGrandfatheredFingerprint(effect) }],
            recordedAt: "2026-09-18T00:01:00.000Z", recordDigest: "",
        };
        const coverage: AgentAutomationCoverage = { ...record, recordDigest: agentAutomationCoverageRecordDigest(record) };
        const taskReference = agentAutomationTaskCommitReference({
            actionId: origin.actionId, taskId: origin.taskId, taskRevision: origin.taskRevision,
            batch: { authorities: [], coverages: [coverage] },
        });
        return { coverage, taskReference };
    }

    function buildRealAuthorityChain(coverage: AgentAutomationCoverage, source: ClientTriggerSource = before) {
        const records = {
            readLineageEvidence: jest.fn().mockResolvedValue({ batch: { authorities: [], coverages: [coverage] }, creationSubjects: [] }),
            verifyTaskCommitReference: jest.fn().mockResolvedValue(true),
        } as unknown as AgentAutomationRecordStoreService;
        const authority = new AgentAutomationAuthorityService(records);
        const sources = {
            readClientAutomationSettings: jest.fn().mockResolvedValue(settings),
            readClientAutomationSource: jest.fn().mockResolvedValue(source),
        };
        const sender = { read: jest.fn().mockReturnValue(senderRead) };
        const service = new AgentAutomationJobAuthorityService(authority, sources as never, sender as never);
        return { service, records };
    }

    function buildTransaction(job: MessageTriggerJobEntity) {
        return {
            message_trigger_job: { findFirst: jest.fn().mockResolvedValue(job) },
            client: { findFirst: jest.fn().mockResolvedValue({ id: clientId, createdAt }) },
            employee_schedule: { findFirst: jest.fn() },
        } as never;
    }

    it("a) real chain: an agent UPDATE that leaves SERVICE_END_NOTICE untouched produces a grandfathered effect, and the real authority allows it at both materialize and dispatch", async () => {
        const impact = buildImpactService();
        const plan = await impact.planClientWrite(branchId, { kind: "update", clientId, values: { fullPrice: "999999" } });
        // A no-op update (nothing SERVICE_END_NOTICE-relevant changed) produces
        // no new/changed `effects`, hence availability "none" -- the grandfathered
        // member (the thing this test is actually about) still comes back.
        expect(plan.availability).toBe("none");
        const grandfathered = plan.grandfatheredEffects?.find((entry) => entry.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        expect(grandfathered).toBeDefined();

        const { coverage, taskReference } = buildCoverageAndReference(grandfathered!);
        const render: CanonicalAutomationRenderer = (job, transaction) => buildRealDelivery().resolveCanonicalDeliverySnapshot(job, transaction);

        // Materialize: job has no receipt link yet, no seal.
        const unenrichedJob = buildUnenrichedJob().withPayloadOverride({ taskAutomationReference: taskReference });
        const { service: materializeService } = buildRealAuthorityChain(coverage);
        const materializeResult = await materializeService.checkAutomaticJob(
            buildTransaction(unenrichedJob), unenrichedJob, "materialize", render,
        );
        expect(materializeResult).toEqual({ status: "legacy" });

        // Dispatch: job carries the real, enricher-issued link; preparedSnapshotHash
        // is the real (unpatched) render hash of that same enriched job.
        const enrichedJob = enrich(buildUnenrichedJob(), "https://example.test/receipt/real-link-a")
            .withPayloadOverride({ taskAutomationReference: taskReference });
        const preparedSnapshotHash = (await render(enrichedJob, {} as never)).snapshotHash;
        const { service: dispatchService } = buildRealAuthorityChain(coverage);
        const dispatchResult = await dispatchService.checkAutomaticJob(
            buildTransaction(enrichedJob), enrichedJob, "dispatch", render, preparedSnapshotHash,
        );
        expect(dispatchResult).toEqual({ status: "legacy" });

        // Control: the client is renamed after coverage was recorded, and the job is
        // rebuilt from the renamed source so it passes the source-payload equality
        // check. Only the grandfathered fingerprint (which binds the rendered text
        // around the link) can refuse it.
        const renamed: ClientTriggerSource = { ...before, name: "다른이름" };
        const renamedRecipe = buildClientMessageRecipe(rule, renamed, new Date("2026-09-01T00:00:00.000Z"));
        if (!renamedRecipe) throw new Error("test setup: renamed recipe must build");
        const renamedJob = buildUnenrichedJob(renamedRecipe).withPayloadOverride({ taskAutomationReference: taskReference });
        const { service: renamedService } = buildRealAuthorityChain(coverage, renamed);
        const renamedResult = await renamedService.checkAutomaticJob(
            buildTransaction(renamedJob), renamedJob, "materialize", render,
        );
        expect(renamedResult).toEqual({ status: "refused", reason: "automation-consent-denied" });
    });

    it("b) an agent CREATE with a future end date makes planClientWrite report availability \"available\" with the SERVICE_END_NOTICE effect present", async () => {
        const impact = buildImpactService();
        // create: no `before` row is read; values seed the new client directly.
        const plan = await impact.planClientWrite(branchId, {
            kind: "create", taskId: "88000000-0000-4000-8000-00000000000a",
            values: { name: before.name, phone: before.phone, startDate: before.startDate, endDate: before.endDate },
        });
        expect(plan.availability).toBe("available");
        const effect = plan.effects.find((entry) => entry.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE);
        expect(effect).toBeDefined();
        expect(effect?.change).toBe("create");
    });

    it("c) tamper: the real link changes between preparation and dispatch is refused", async () => {
        const impact = buildImpactService();
        const plan = await impact.planClientWrite(branchId, { kind: "update", clientId, values: { fullPrice: "999999" } });
        const grandfathered = plan.grandfatheredEffects!.find((entry) => entry.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE)!;
        const { coverage, taskReference } = buildCoverageAndReference(grandfathered);
        const render: CanonicalAutomationRenderer = (job, transaction) => buildRealDelivery().resolveCanonicalDeliverySnapshot(job, transaction);

        const preparedJob = enrich(buildUnenrichedJob(), "https://example.test/receipt/real-link-a")
            .withPayloadOverride({ taskAutomationReference: taskReference });
        const preparedSnapshotHash = (await render(preparedJob, {} as never)).snapshotHash;

        // The job that actually reaches dispatch carries a DIFFERENT real link.
        const dispatchedJob = enrich(buildUnenrichedJob(), "https://example.test/receipt/real-link-b")
            .withPayloadOverride({ taskAutomationReference: taskReference });
        const { service } = buildRealAuthorityChain(coverage);
        const result = await service.checkAutomaticJob(buildTransaction(dispatchedJob), dispatchedJob, "dispatch", render, preparedSnapshotHash);
        expect(result).toMatchObject({ status: "refused" });
    });
});
