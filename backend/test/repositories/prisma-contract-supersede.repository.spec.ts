import { PrismaContractSupersedeRepository } from "infrastructure/database/repositories/prisma-contract-supersede.repository";

function build() {
    const prisma = {
        eformsign_doc: { findUnique: jest.fn().mockResolvedValue(null) },
        branch: { findUnique: jest.fn() },
    };
    return { prisma, repository: new PrismaContractSupersedeRepository(prisma as never) };
}

describe("PrismaContractSupersedeRepository", () => {
    it("reads the document by its id alone, so headquarters still reaches unassigned documents", async () => {
        const { prisma, repository } = build();

        await repository.findSupersedeCandidate("old-doc");

        expect(prisma.eformsign_doc.findUnique).toHaveBeenCalledWith({
            where: { documentId: "old-doc" },
            select: {
                clientId: true, documentKind: true,
                statusType: true, stepType: true, stepName: true,
            },
        });
    });

    it("recognises the headquarters branch by its slug", async () => {
        const { prisma, repository } = build();
        prisma.branch.findUnique.mockResolvedValueOnce({ slug: "incheon" }).mockResolvedValueOnce({ slug: "gimpo" });

        await expect(repository.isHeadquartersBranch("hq")).resolves.toBe(true);
        await expect(repository.isHeadquartersBranch("other")).resolves.toBe(false);
        await expect(repository.isHeadquartersBranch("")).resolves.toBe(false);
        expect(prisma.branch.findUnique).toHaveBeenCalledWith({ where: { id: "hq" }, select: { slug: true } });
    });
});
