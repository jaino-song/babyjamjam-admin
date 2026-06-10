import { NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";

describe("CallIngestTokenService", () => {
    const prisma = {
        call_ingest_token: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
    };
    let service: CallIngestTokenService;

    beforeEach(() => {
        jest.resetAllMocks();
        service = new CallIngestTokenService(prisma as never);
    });

    it("creates a token with cit_ prefix and stores only the sha256 hash", async () => {
        prisma.call_ingest_token.create.mockImplementation(async ({ data }: { data: { tokenHash: string } }) => ({
            id: "tok-1", ...data,
        }));

        const result = await service.createToken("branch-1", "인천본점 n8n");

        expect(result.token).toMatch(/^cit_[A-Za-z0-9_-]{43,}$/);
        const storedHash = prisma.call_ingest_token.create.mock.calls[0][0].data.tokenHash;
        expect(storedHash).toBe(createHash("sha256").update(result.token).digest("hex"));
        expect(prisma.call_ingest_token.create.mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("resolves branchId for an active token and touches lastUsedAt", async () => {
        const token = "cit_test-token";
        prisma.call_ingest_token.findUnique.mockResolvedValue({
            id: "tok-1", branchId: "branch-1", active: true,
        });
        prisma.call_ingest_token.update.mockResolvedValue({});

        await expect(service.resolveBranchId(token)).resolves.toBe("branch-1");
        expect(prisma.call_ingest_token.findUnique).toHaveBeenCalledWith({
            where: { tokenHash: createHash("sha256").update(token).digest("hex") },
        });
        expect(prisma.call_ingest_token.update).toHaveBeenCalled();
    });

    it("returns null for revoked or unknown tokens", async () => {
        prisma.call_ingest_token.findUnique.mockResolvedValue({ id: "tok-1", branchId: "b", active: false });
        await expect(service.resolveBranchId("cit_revoked")).resolves.toBeNull();

        prisma.call_ingest_token.findUnique.mockResolvedValue(null);
        await expect(service.resolveBranchId("cit_unknown")).resolves.toBeNull();
    });

    it("revokes a token scoped to its branch", async () => {
        prisma.call_ingest_token.updateMany = jest.fn().mockResolvedValue({ count: 1 });
        await service.revoke("tok-1", "branch-1");
        expect(prisma.call_ingest_token.updateMany).toHaveBeenCalledWith({
            where: { id: "tok-1", branchId: "branch-1" },
            data: { active: false, revokedAt: expect.any(Date) },
        });
    });

    it("404s when revoking a token from another branch", async () => {
        prisma.call_ingest_token.updateMany = jest.fn().mockResolvedValue({ count: 0 });
        await expect(service.revoke("tok-1", "branch-2")).rejects.toThrow(NotFoundException);
    });
});
