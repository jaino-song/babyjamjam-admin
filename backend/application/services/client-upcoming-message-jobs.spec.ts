import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MessageTriggerTemplateKey, MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import type { ClientUpcomingMessageTriggerJobRecord } from "domain/repositories/message-trigger-job.repository.interface";
import { MessageTriggerService } from "./message-trigger.service";

describe("MessageTriggerService.listClientUpcomingJobs", () => {
    const branchId = "branch-1";
    const clientId = 42;

    function createRow(overrides: Partial<ClientUpcomingMessageTriggerJobRecord> = {}): ClientUpcomingMessageTriggerJobRecord {
        return {
            id: "job-1",
            ruleName: "서비스 안내",
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            status: "pending",
            scheduledFor: new Date("2026-09-28T06:00:00.000Z"),
            nextAttemptAt: null,
            effectiveDueAt: new Date("2026-09-28T06:00:00.000Z"),
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientName: "김고객",
            ...overrides,
        };
    }

    function createService(options: {
        rows?: ClientUpcomingMessageTriggerJobRecord[];
        client?: unknown;
        schemaPresent?: boolean;
    } = {}) {
        const jobRepository = {
            findUpcomingByClient: jest.fn().mockResolvedValue(options.rows ?? [createRow()]),
        };
        const clientRepository = {
            findById: jest.fn().mockResolvedValue(options.client === undefined ? { id: clientId } : options.client),
        };
        const automationSources = {
            hasTriggerSchema: jest.fn().mockResolvedValue(options.schemaPresent ?? true),
        };
        const service = new MessageTriggerService(
            { client: { findFirst: jest.fn() } } as never,
            {} as never,
            {} as never,
            {} as never,
            jobRepository as never,
            {} as never,
            {} as never,
            {} as never,
            undefined,
            undefined,
            undefined,
            undefined,
            automationSources as never,
            undefined,
            clientRepository as never,
        );
        return { service, jobRepository, clientRepository, automationSources };
    }

    it("returns only the safe scheduled-message projection and asks for one lookahead row", async () => {
        const row = createRow({
            id: "job-safe",
            status: "pending",
            scheduledFor: new Date("2026-09-28T06:00:00.000Z"),
            nextAttemptAt: new Date("2026-09-28T06:30:00.000Z"),
            effectiveDueAt: new Date("2026-09-28T06:30:00.000Z"),
        });
        const { service, jobRepository } = createService({ rows: [row] });

        const result = await service.listClientUpcomingJobs(branchId, clientId, 50);

        expect(jobRepository.findUpcomingByClient).toHaveBeenCalledWith(branchId, clientId, 51, undefined);
        expect(result.nextCursor).toBeNull();
        expect(result.items).toEqual([{
            id: "job-safe",
            ruleName: "서비스 안내",
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            scheduledFor: new Date("2026-09-28T06:00:00.000Z"),
            nextAttemptAt: new Date("2026-09-28T06:30:00.000Z"),
            effectiveDueAt: new Date("2026-09-28T06:30:00.000Z"),
            status: "pending",
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientName: "김고객",
        }]);
        expect(Object.keys(result.items[0] ?? {}).sort()).toEqual([
            "effectiveDueAt",
            "id",
            "nextAttemptAt",
            "recipientName",
            "recipientType",
            "ruleName",
            "scheduledFor",
            "status",
            "templateKey",
        ]);
    });

    it("uses a stable effectiveDueAt/id cursor and returns the next cursor only with a lookahead", async () => {
        const first = createRow({ id: "job-first" });
        const lookahead = createRow({ id: "job-second", effectiveDueAt: new Date("2026-09-28T07:00:00.000Z") });
        const { service, jobRepository } = createService({ rows: [first, lookahead] });

        const firstPage = await service.listClientUpcomingJobs(branchId, clientId, 1);
        const encoded = firstPage.nextCursor;
        expect(encoded).toBeTruthy();
        expect(JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"))).toEqual({
            v: 1,
            branchId,
            clientId,
            effectiveDueAt: first.effectiveDueAt.toISOString(),
            id: "job-first",
        });

        await service.listClientUpcomingJobs(branchId, clientId, 1, encoded!);
        expect(jobRepository.findUpcomingByClient).toHaveBeenLastCalledWith(
            branchId,
            clientId,
            2,
            { effectiveDueAt: first.effectiveDueAt, id: "job-first" },
        );
    });

    it("rejects malformed cursors before querying jobs", async () => {
        const { service, jobRepository } = createService();

        await expect(service.listClientUpcomingJobs(branchId, clientId, 50, "not-a-cursor"))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(jobRepository.findUpcomingByClient).not.toHaveBeenCalled();
    });

    it("returns a generic not-found for a client outside the authenticated branch", async () => {
        const { service, jobRepository, clientRepository } = createService({ client: null });

        await expect(service.listClientUpcomingJobs(branchId, clientId, 50))
            .rejects.toBeInstanceOf(NotFoundException);
        expect(clientRepository.findById).toHaveBeenCalledWith(branchId, clientId);
        expect(jobRepository.findUpcomingByClient).not.toHaveBeenCalled();
    });

    it("validates client ids and does not touch the repository", async () => {
        const { service, jobRepository } = createService();

        await expect(service.listClientUpcomingJobs(branchId, 0, 50))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(jobRepository.findUpcomingByClient).not.toHaveBeenCalled();
    });

    it("returns an empty page when the trigger schema is unavailable without reconciling", async () => {
        const { service, jobRepository, automationSources } = createService({ schemaPresent: false });

        await expect(service.listClientUpcomingJobs(branchId, clientId, 50))
            .resolves.toEqual({ items: [], nextCursor: null });
        expect(automationSources.hasTriggerSchema).toHaveBeenCalledTimes(1);
        expect(jobRepository.findUpcomingByClient).not.toHaveBeenCalled();
    });
});
