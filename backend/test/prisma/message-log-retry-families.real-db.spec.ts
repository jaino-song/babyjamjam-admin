import { PrismaClient } from "@prisma/client";

import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";

// Opt in only after migrations have been deployed to a local throwaway DB.
const describeReal = process.env["MESSAGE_LOG_RETRY_FAMILIES_REAL_DB"] === "1" ? describe : describe.skip;
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;

describeReal("batched retry families (real PostgreSQL)", () => {
    let prisma: PrismaClient;
    let repository: SbMessageLogRepository;
    const branches: string[] = [];

    beforeAll(async () => {
        const url = process.env["DATABASE_URL"];
        if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
            throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL must match a local throwaway database");
        }
        prisma = new PrismaClient();
        await prisma.$connect();
        repository = new SbMessageLogRepository(prisma as unknown as PrismaService);
        for (const name of ["a", "b"]) {
            const branch = await prisma.branch.create({
                data: { name, slug: `throwaway-retry-families-${name}-${Date.now()}` },
            });
            branches.push(branch.id);
        }
    });

    afterAll(async () => {
        if (!prisma) return;
        try {
            await prisma.message_log.deleteMany({ where: { branchId: { in: branches } } });
            await prisma.branch.deleteMany({ where: { id: { in: branches } } });
        } finally {
            await prisma.$disconnect();
        }
    });

    it("walks ancestors and descendants for two seeds without crossing branches", async () => {
        const [branchA, branchB] = branches as [string, string];
        const log = (branchId: string, parent?: number) => prisma.message_log.create({ data: {
            branchId, provider: "aligo_sms", templateKey: "retry_family_test", receiver: "01000000000",
            messageBody: "test", variables: parent === undefined ? {} : { retryOfLogId: String(parent) },
            status: "failed",
        } });
        const root = await log(branchA);
        const child = await log(branchA, root.id);
        const grandchild = await log(branchA, child.id);
        const sibling = await log(branchA, root.id);
        const foreignChild = await log(branchB, child.id);
        // A same-branch descendant behind a foreign ancestor is also unrelated.
        const behindForeign = await log(branchA, foreignChild.id);
        const families = await repository.findRetryFamiliesInBranch(branchA, [child.id, grandchild.id, foreignChild.id]);
        const expected = [root.id, child.id, grandchild.id, sibling.id].sort((a, b) => a - b);
        for (const seed of [child.id, grandchild.id]) {
            expect(families.get(seed)?.map((member) => member.id).sort((a, b) => a - b)).toEqual(expected);
            expect(families.get(seed)?.some((member) => member.id === behindForeign.id)).toBe(false);
        }
        expect(families.has(foreignChild.id)).toBe(false);
        const foreignFamily = await repository.findRetryFamiliesInBranch(branchB, [foreignChild.id, root.id]);
        expect(foreignFamily.get(foreignChild.id)?.map((member) => member.id)).toEqual([foreignChild.id]);
        expect(foreignFamily.has(root.id)).toBe(false);
    });
});
