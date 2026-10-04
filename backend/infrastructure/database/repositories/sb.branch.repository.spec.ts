import { PrismaService } from "infrastructure/database/prisma.service";

import { SbBranchRepository } from "./sb.branch.repository";

describe("SbBranchRepository", () => {
    it("lists inactive branches too without changing the active-only query", async () => {
        const rows = [
            { id: "branch-a", name: "A", slug: "a", isActive: true },
            { id: "branch-b", name: "B", slug: "b", isActive: false },
        ];
        const findMany = jest.fn(async (query: { where?: { isActive: boolean } }) =>
            rows.filter((row) => query.where === undefined || row.isActive === query.where.isActive),
        );
        const repository = new SbBranchRepository({ branch: { findMany } } as unknown as PrismaService);

        expect((await repository.findAll()).map((branch) => branch.id)).toEqual(["branch-a", "branch-b"]);
        expect(findMany).toHaveBeenLastCalledWith({ select: { id: true, name: true } });
        expect(await repository.findAllActive()).toEqual([{ id: "branch-a", name: "A" }]);
        expect(findMany).toHaveBeenLastCalledWith({
            where: { isActive: true },
            select: { id: true, name: true, slug: true },
        });
    });
});
