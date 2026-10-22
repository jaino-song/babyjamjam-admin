import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import type { ContractDataDto } from "application/dto/contract.dto";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { EformsignService } from "application/services/eformsign.service";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { SchedulerLeaseModule } from "module/scheduler-lease.module";

const LIVE = process.env["LIVE_E2E"] === "1";
const RUN_ID = Date.now().toString(36);
const CUSTOMER_NAME = `큐생성-E2E-CONTRACT-${RUN_ID}-삭제예정`;
const TEST_CUSTOMER_PHONE = "01000000000";
const TEST_AREA = "Seogu";

const buildContract = (employeeName: string, employeePhone: string): ContractDataDto => ({
    customerName: CUSTOMER_NAME,
    customerContact: TEST_CUSTOMER_PHONE,
    customerDOB: "900101",
    customerAddress: "E2E 삭제예정 테스트 주소",
    caretaker1Name: employeeName,
    caretaker1Contact: employeePhone,
    type: "산모신생아건강관리",
    days: "5",
    area: TEST_AREA,
    contractDuration: "5일",
    startYear: "26",
    startMonth: "11",
    startDay: "24",
    startDate: "2026-11-24",
    endYear: "26",
    endMonth: "11",
    endDay: "30",
    endDate: "2026-11-30",
    paymentYear: "26",
    paymentMonth: "11",
    paymentDay: "24",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    issuerPhone: TEST_CUSTOMER_PHONE,
});

(LIVE ? describe : describe.skip)("durable eformsign document queue live smoke", () => {
    jest.setTimeout(300_000);

    let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
    let prisma: PrismaService;
    let jobService: EformsignDocumentJobService;
    let worker: EformsignDocumentJobWorkerService;
    let eformsignService: EformsignService;
    let eformsignClient: IEformsignClientRepository;
    let branchId = "";
    let clientId = 0;
    let remoteDocumentId: string | undefined;
    const runStartedAt = Date.now();

    const getAccessToken = async () => eformsignClient.getAccessToken(Date.now());

    const findRemoteDocument = async (): Promise<string | undefined> => {
        const token = await getAccessToken();
        const candidates = (await eformsignClient.getAllDocuments(token.oauth_token.access_token))
            .filter((document) => document.created_date >= runStartedAt - 5_000)
            .slice(0, 30);
        const matches: string[] = [];
        for (const candidate of candidates) {
            try {
                const detail = await eformsignClient.getDocument(
                    token.oauth_token.access_token,
                    candidate.id,
                );
                if (detail.fields?.some((field) => (
                    field.id === "이용자 성명" && field.value === CUSTOMER_NAME
                ))) {
                    matches.push(candidate.id);
                }
            } catch {
                // A concurrently deleted document is irrelevant to this isolated run.
            }
        }
        if (matches.length > 1) {
            throw new Error("multiple remote documents matched the synthetic queue smoke identity");
        }
        return matches[0];
    };

    beforeAll(async () => {
        const databaseUrl = new URL(process.env["DATABASE_URL"] ?? "");
        expect(["localhost", "127.0.0.1", "::1"]).toContain(databaseUrl.hostname);
        expect(process.env["E2E_VENDOR_STUBS"]).not.toBe("1");
        expect(process.env["EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED"]).toBe("true");

        moduleRef = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true }), TenantModule, EformsignDocModule, SchedulerLeaseModule],
        }).compile();

        prisma = moduleRef.get(PrismaService, { strict: false });
        jobService = moduleRef.get(EformsignDocumentJobService, { strict: false });
        worker = moduleRef.get(EformsignDocumentJobWorkerService, { strict: false });
        eformsignService = moduleRef.get(EformsignService, { strict: false });
        eformsignClient = moduleRef.get(EFORMSIGN_CLIENT_REPOSITORY, { strict: false });

        const templateId = process.env["EFORMSIGN_TEMPLATE_ID"]?.trim();
        if (!templateId) throw new Error("EFORMSIGN_TEMPLATE_ID is required for the live smoke");

        const branch = await prisma.branch.create({
            data: { name: "Queue Live Smoke", slug: `queue-live-smoke-${RUN_ID}` },
        });
        branchId = branch.id;
        const area = await prisma.area.create({
            data: {
                id: `queue-live-smoke-area-${RUN_ID}`,
                name: TEST_AREA,
                koreanName: "큐 라이브 스모크",
                branchId,
            },
        });
        await prisma.doc_template.create({
            data: { areaId: area.id, templateId, templateName: "Queue live smoke" },
        });
        const employee = await prisma.employee.create({
            data: {
                name: `테스트제공인력-${RUN_ID}`,
                phone: `019${RUN_ID.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`,
                workArea: ["E2E"],
                grade: "E2E",
                branchId,
            },
        });
        const client = await prisma.client.create({
            data: {
                name: CUSTOMER_NAME,
                bookingConfirmedAt: new Date("2026-01-01"),
                phone: TEST_CUSTOMER_PHONE,
                address: "E2E 삭제예정 테스트 주소",
                birthday: "900101",
                duration: 5,
                fullPrice: "1000000",
                grant: "800000",
                actualPrice: "200000",
                voucherClient: false,
                suppressGreetingSms: true,
                branchId,
                startDate: new Date("2026-11-24T00:00:00.000Z"),
                endDate: new Date("2026-11-30T00:00:00.000Z"),
            },
        });
        clientId = client.id;
        await prisma.employee_schedule.create({
            data: {
                primaryEmployeeId: employee.id,
                clientId,
                branchId,
                workAddress: "E2E 삭제예정 테스트 주소",
                startDate: new Date("2026-11-24T00:00:00.000Z"),
                endDate: new Date("2026-11-30T00:00:00.000Z"),
            },
        });
    });

    afterAll(async () => {
        try {
            remoteDocumentId ??= await findRemoteDocument();
            if (remoteDocumentId) {
                const token = await getAccessToken();
                await eformsignService.deleteDocuments(
                    token.oauth_token.access_token,
                    [remoteDocumentId],
                    true,
                );
                const cleanupDeadline = Date.now() + 30_000;
                while (await findRemoteDocument()) {
                    if (Date.now() >= cleanupDeadline) {
                        throw new Error("remote queue smoke document still exists after cleanup");
                    }
                    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
                }
                console.log("[cleanup] permanently deleted and verified the queue smoke document");
            }
        } finally {
            await moduleRef?.close();
        }
    });

    it("enqueues once, runs through the worker, and clears the durable payload", async () => {
        const requestKey = `queue-live-smoke:${RUN_ID}`;
        const contractData = buildContract(
            (await prisma.employee.findFirstOrThrow({ where: { branchId } })).name,
            (await prisma.employee.findFirstOrThrow({ where: { branchId } })).phone,
        );
        const first = await jobService.enqueueCreateDocument({
            branchId,
            clientId,
            contractData,
            requestKey,
            source: "staff",
        });
        expect(first.existing).toBe(false);

        const replay = await jobService.enqueueCreateDocument({
            branchId,
            clientId,
            contractData,
            requestKey,
            source: "staff",
        });
        expect(replay).toEqual(expect.objectContaining({ existing: true }));
        expect(replay.job.id).toBe(first.job.id);
        await expect(jobService.getSummary(branchId)).resolves.toEqual({
            activeCount: 1,
            requiresAttentionCount: 0,
            failedCount: 0,
            unresolvedCount: 0,
            unresolvedJobIds: [],
        });

        await worker.processDueJobs();

        const stored = await prisma.eformsign_document_job.findUniqueOrThrow({
            where: { id: first.job.id },
        });
        expect(stored.status).toBe("completed");
        expect(stored.payload).toBeNull();
        expect(stored.activeKey).toBeNull();
        expect(stored.documentId).toBeTruthy();
        remoteDocumentId = stored.documentId ?? undefined;
        await expect(jobService.getSummary(branchId)).resolves.toEqual({
            activeCount: 0,
            requiresAttentionCount: 0,
            failedCount: 0,
            unresolvedCount: 0,
            unresolvedJobIds: [],
        });

        const listed = await jobService.listForBranch(branchId, new Date(Date.now() - 60_000), 50);
        expect(listed.active).toHaveLength(0);
        expect(listed.requiresAttention).toHaveLength(0);
        expect(listed.recent).toEqual([
            expect.objectContaining({
                id: first.job.id,
                status: "completed",
                documentId: remoteDocumentId,
                payload: null,
            }),
        ]);
    });

    it("lets staff claim, resolve and purge stuck contract jobs without touching the provider", async () => {
        const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const start = new Date();
        const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
        const claimTtlMs = 10 * 60_000;
        const create = (suffix: string, data: Record<string, unknown>) => prisma.eformsign_document_job.create({
            data: {
                branchId,
                clientId,
                jobType: "create_document",
                source: "staff",
                status: "failed",
                requestKey: `queue-live-recovery:${RUN_ID}:${suffix}`,
                payload: { clientId },
                payloadFingerprint: "a".repeat(64),
                progressStep: "preparing",
                completedAt: start,
                lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED",
                ...data,
            },
        });
        const failed = await create("failed", {});
        const baseInput = { jobId: failed.id, branchId };

        await expect(jobService.getSummary(branchId)).resolves.toMatchObject({
            failedCount: 1,
            unresolvedCount: 1,
            unresolvedJobIds: [failed.id],
        });
        const listedBefore = await jobService.listForBranch(branchId, new Date(start.getTime() - 60_000), 50);
        expect(listedBefore.requiresAttention.map((job) => job.id)).toEqual([failed.id]);
        expect(listedBefore.requiresAttention[0]?.clientName).toBe(CUSTOMER_NAME);
        expect(listedBefore.recent.map((job) => job.id)).not.toContain(failed.id);

        // A takes the claim; B is held off until it expires; A may renew its own claim.
        const first = await jobService.claimRecovery({ ...baseInput, userId: userA, now: start });
        expect(first).toMatchObject({ kind: "claimed", job: { payload: { clientId } } });
        await expect(jobService.claimRecovery({ ...baseInput, userId: userB, now: at(1) })).resolves.toEqual({
            kind: "claimed_by_other",
            expiresAt: new Date(start.getTime() + claimTtlMs),
        });
        await expect(jobService.claimRecovery({ ...baseInput, userId: userA, now: at(2) }))
            .resolves.toMatchObject({ kind: "claimed" });
        await expect(jobService.claimRecovery({ ...baseInput, userId: userB, now: at(13) }))
            .resolves.toMatchObject({ kind: "claimed" });

        // A cannot resolve under B's live claim; B can, and a replay is a success.
        await expect(jobService.resolveManually({ ...baseInput, userId: userA, now: at(14) }))
            .resolves.toMatchObject({ kind: "claimed_by_other" });
        await expect(jobService.resolveManually({ ...baseInput, userId: userB, now: at(14) }))
            .resolves.toMatchObject({ kind: "resolved", job: { status: "completed", progressStep: "manual_resolved" } });
        await expect(jobService.resolveManually({ ...baseInput, userId: userB, now: at(15) }))
            .resolves.toMatchObject({ kind: "already_resolved" });
        await expect(jobService.claimRecovery({ ...baseInput, userId: userA, now: at(16) }))
            .resolves.toEqual({ kind: "invalid_state", status: "completed" });
        const resolved = await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: failed.id } });
        expect(resolved).toMatchObject({
            status: "completed",
            progressStep: "manual_resolved",
            payload: null,
            activeKey: null,
            leaseToken: null,
            lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED",
        });
        await expect(jobService.getSummary(branchId)).resolves.toMatchObject({ failedCount: 0, unresolvedCount: 0 });

        // Another branch's job is never reachable.
        await expect(jobService.claimRecovery({
            jobId: failed.id,
            branchId: "00000000-0000-4000-8000-0000000000aa",
            userId: userA,
            now: start,
        })).resolves.toEqual({ kind: "not_found" });

        // Purge nulls only an old contract requires_attention payload and keeps its active key.
        const eightDaysAgo = new Date(start.getTime() - 8 * 24 * 60 * 60_000);
        const oldAttention = await create("old-attention", {
            status: "requires_attention",
            activeKey: `queue-live-recovery:${RUN_ID}:old-attention`,
            completedAt: eightDaysAgo,
            lastErrorCode: "AMBIGUOUS_PROVIDER_STATE",
        });
        const freshAttention = await create("fresh-attention", {
            status: "requires_attention",
            activeKey: `queue-live-recovery:${RUN_ID}:fresh-attention`,
            lastErrorCode: "AMBIGUOUS_PROVIDER_STATE",
        });
        const oldRevision = await prisma.eformsign_document_job.create({
            data: {
                branchId,
                clientId,
                jobType: "create_document",
                source: "staff",
                status: "requires_attention",
                requestKey: `service-record-queue-live-recovery:${RUN_ID}`,
                activeKey: `service-record-queue-live-recovery:${RUN_ID}`,
                payload: { kind: "service_record_revision_operations" },
                payloadFingerprint: "b".repeat(64),
                completedAt: eightDaysAgo,
                lastErrorCode: "AMBIGUOUS_PROVIDER_STATE",
            },
        });
        await expect(jobService.purgeExpiredAttentionPayloads(start)).resolves.toBeGreaterThanOrEqual(1);
        const [purged, fresh, revision] = await Promise.all([
            prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: oldAttention.id } }),
            prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: freshAttention.id } }),
            prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: oldRevision.id } }),
        ]);
        expect(purged.payload).toBeNull();
        expect(purged.activeKey).toBe(`queue-live-recovery:${RUN_ID}:old-attention`);
        expect(fresh.payload).toEqual({ clientId });
        expect(revision.payload).toEqual({ kind: "service_record_revision_operations" });

        const failures = await jobService.listRecentStaffFailures(new Date(start.getTime() - 60_000));
        expect(failures.map((job) => job.id)).toEqual(expect.arrayContaining([freshAttention.id]));
        expect(failures.map((job) => job.id)).not.toContain(oldRevision.id);
    });
});
