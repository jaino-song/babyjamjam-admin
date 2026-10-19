import { PrismaClient } from "@prisma/client";

import { SmsAutomationSafeguardService, type SmsSafeguardJob } from "application/services/sms-automation-safeguard.service";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";

const describeE2E = process.env["E2E_SMS_SAFEGUARD_TOMBSTONE"] === "1" ? describe : describe.skip;

const prisma = new PrismaClient();

describeE2E("SMS safeguard vs deleted clients (real PostgreSQL)", () => {
    let branchId: string;
    let otherBranchId: string;
    const service = new SmsAutomationSafeguardService(
        prisma as never,
        { getTriggerDispatchEnabled: async () => true } as never,
    );

    const agentJob = (recipientPhone: string, branch: string = branchId): SmsSafeguardJob => ({
        branchId: branch, ruleId: `agent-sms:${branch}`, templateKey: MessageTriggerTemplateKey.INFO,
        dedupeKey: "agent-sms:action-1", clientId: null, employeeScheduleId: null,
        recipientType: MessageTriggerRecipientType.CLIENT, recipientPhone,
    });

    // A tombstone: deleted_at set, phone_normalized cleared, the raw phone kept as typed.
    const tombstone = (phone: string, smsAutomationEnabled: boolean, branch: string = branchId) =>
        prisma.client.create({
            data: { name: `tomb-${phone}`, phone, phoneNormalized: null, smsAutomationEnabled, deletedAt: new Date(), branchId: branch, voucherClient: false },
            select: { id: true },
        });

    beforeAll(async () => {
        await prisma.$connect();
        branchId = (await prisma.branch.create({ data: { name: "sms tomb A", slug: `sms-tomb-a-${process.pid}-${Date.now()}` }, select: { id: true } })).id;
        otherBranchId = (await prisma.branch.create({ data: { name: "sms tomb B", slug: `sms-tomb-b-${process.pid}-${Date.now()}` }, select: { id: true } })).id;
    });

    afterEach(async () => {
        await prisma.client.deleteMany({ where: { branchId: { in: [branchId, otherBranchId] } } });
    });

    afterAll(async () => {
        await prisma.branch.deleteMany({ where: { id: { in: [branchId, otherBranchId] } } });
        await prisma.$disconnect();
    });

    it.each(["+82 10-1234-5678", "010.1234.5678", "010 1234 5678", "01012345678", "010-1234-5678", "82-10-1234-5678"])(
        "blocks a recipient when the deleted opted-out client was stored as %s",
        async (raw) => {
            const { id } = await tombstone(raw, false);
            await expect(service.check(agentJob("01012345678"))).resolves.toMatchObject({
                allowed: false, level: "recipient", reason: "matched deleted client SMS automation is off",
                recipient: { kind: "client", id },
            });
            await expect(service.check(agentJob("+82 10-1234-5678"))).resolves.toMatchObject({ allowed: false });
        },
    );

    it("blocks a multi-recipient job when one key matches the tombstone, even if another key has a live opted-in owner", async () => {
        await tombstone("+82 10-1234-5678", false);
        await prisma.client.create({
            data: { name: "live other", phone: "010-9999-8888", phoneNormalized: "01099998888", smsAutomationEnabled: true, branchId, voucherClient: false },
        });
        await expect(service.check(agentJob("01012345678,01099998888"))).resolves.toMatchObject({ allowed: false, level: "recipient" });
    });

    it("is not cleared by a live opted-in owner of the same phone", async () => {
        await tombstone("010 1234 5678", false);
        await prisma.client.create({
            data: { name: "live same", phone: "010-1234-5678", phoneNormalized: "01012345678", smsAutomationEnabled: true, branchId, voucherClient: false },
        });
        await expect(service.check(agentJob("01012345678"))).resolves.toMatchObject({ allowed: false, level: "recipient" });
    });

    it("negative controls: opted-in tombstone, other branch, unrelated phone are all allowed", async () => {
        await tombstone("+82 10-1234-5678", true);
        await expect(service.check(agentJob("01012345678"))).resolves.toEqual({ allowed: true });
        await tombstone("010.5555.6666", false, otherBranchId);
        await expect(service.check(agentJob("01055556666"))).resolves.toEqual({ allowed: true });
        await tombstone("010.7777.8888", false);
        await expect(service.check(agentJob("01012345678"))).resolves.toEqual({ allowed: true });
    });
});
