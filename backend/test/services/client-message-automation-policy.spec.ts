import { Prisma } from "@prisma/client";

import {
    cancelAutomaticMessageJobsForClient,
    isClientMessageAutomationDisabled,
    lockClientMessageAutomationForJob,
} from "application/services/client-message-automation-policy";
import { ClientEntity } from "domain/entities/client.entity";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";

function transactionDouble(overrides: Record<string, unknown> = {}): Prisma.TransactionClient {
    return {
        ...overrides,
        client: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
        },
        message_trigger_job: {
            updateMany: jest.fn(),
        },
    } as unknown as Prisma.TransactionClient;
}

describe("client message automation policy", () => {
    it("persists an explicitly supplied false without adding a field to legacy writes", () => {
        const base = {
            name: "고객",
            address: null,
            phone: "01012345678",
            type: null,
            duration: null,
            fullPrice: null,
            grant: null,
            actualPrice: null,
            startDate: null,
            endDate: null,
            careCenter: null,
            voucherClient: false,
            birthday: null,
            dueDate: null,
            birthDate: null,
            serviceStatus: null,
            breastPump: false,
            eDocId: null,
        };
        const legacy = ClientEntity.create(base);
        const explicitFalse = ClientEntity.create({ ...base, messageAutomationDisabled: false });

        expect(ClientMapper.toPrismaCreate(legacy)).not.toHaveProperty("messageAutomationDisabled");
        expect(ClientMapper.toPrismaCreate(explicitFalse)).toHaveProperty("messageAutomationDisabled", false);
    });

    it("reads the durable flag through the transaction client", async () => {
        const transaction = transactionDouble();
        const findUnique = transaction.client.findUnique as jest.Mock;
        findUnique.mockResolvedValue({ messageAutomationDisabled: true });

        await expect(isClientMessageAutomationDisabled(transaction, 41)).resolves.toBe(true);
        expect(findUnique).toHaveBeenCalledWith({
            where: { id: 41 },
            select: { messageAutomationDisabled: true },
        });
    });

    it("locks the client before reading a job-owned durable flag", async () => {
        const transaction = transactionDouble({
            $queryRaw: jest.fn().mockResolvedValue([{ message_automation_disabled: true }]),
        });

        await expect(lockClientMessageAutomationForJob(transaction, {
            branchId: "branch-1",
            clientId: 41,
            employeeScheduleId: 7,
        })).resolves.toBe(true);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("cancels only rows returned by the automatic ownership query", async () => {
        const queryRaw = jest.fn()
            .mockResolvedValueOnce([{ id: "automatic-job" }])
            .mockResolvedValueOnce([{ id: "automatic-job" }]);
        const transaction = transactionDouble({ $queryRaw: queryRaw });

        await expect(cancelAutomaticMessageJobsForClient(transaction, "branch-1", 41)).resolves.toBe(1);
        expect(queryRaw).toHaveBeenCalledTimes(2);
        const selection = queryRaw.mock.calls[0]?.[0] as { strings?: readonly string[] };
        const selectionSql = selection.strings?.join("?") ?? "";
        expect(selectionSql).toContain("job.\"status\" = 'failed'");
        expect(selectionSql).toContain("job.\"rule_id\"");
        expect(selectionSql).toContain("job.\"cancel_reason\"");
    });

    it("retires failed internal recovery markers through the fallback transaction delegate", async () => {
        const pendingUpdate = jest.fn().mockResolvedValue({ count: 1 });
        const transaction = transactionDouble();
        transaction.message_trigger_job.updateMany = pendingUpdate;
        pendingUpdate.mockImplementationOnce(async () => ({ count: 1 }));
        pendingUpdate.mockImplementationOnce(async () => ({ count: 2 }));

        await expect(cancelAutomaticMessageJobsForClient(transaction, "branch-1", 41)).resolves.toBe(3);
        expect(pendingUpdate).toHaveBeenCalledTimes(2);
        expect(pendingUpdate.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            where: expect.objectContaining({
                ruleId: "system:message_automation_intent",
                status: "failed",
                cancelReason: "메시지 자동화 생성 재시도 대기",
            }),
        }));
    });
});
