import { DocumentCategoryService } from "application/services/document-category.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("DocumentCategoryService", () => {
    const createPrismaService = () => ({
        document_category: {
            findMany: jest.fn(),
            create: jest.fn(),
            deleteMany: jest.fn(),
        },
    });

    let prisma: ReturnType<typeof createPrismaService>;
    let service: DocumentCategoryService;

    beforeEach(() => {
        prisma = createPrismaService();
        service = new DocumentCategoryService(prisma as unknown as PrismaService);
    });

    it("should list global and branch-specific categories only", async () => {
        prisma.document_category.findMany.mockResolvedValue([
            {
                id: "global-category",
                value: "contract",
                label: "계약서",
                color: "primary",
                isCustom: false,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
            },
        ]);

        await service.findAll("branch-1");

        expect(prisma.document_category.findMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { branchId: "branch-1" },
                    { branchId: null },
                ],
            },
            orderBy: { createdAt: "asc" },
        });
    });

    it("should persist custom categories under the selected branch", async () => {
        prisma.document_category.create.mockResolvedValue({
            id: "category-1",
            value: "branch-contract",
            label: "Branch Contract",
            color: "primary",
            isCustom: true,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
        });

        await service.create({
            branchId: "branch-1",
            value: "branch-contract",
            label: "Branch Contract",
            color: "primary",
        });

        expect(prisma.document_category.create).toHaveBeenCalledWith({
            data: {
                branchId: "branch-1",
                value: "branch-contract",
                label: "Branch Contract",
                color: "primary",
                isCustom: true,
            },
        });
    });

    it("should delete only custom categories in the selected branch", async () => {
        prisma.document_category.deleteMany.mockResolvedValue({ count: 1 });

        await service.delete("branch-1", "category-1");

        expect(prisma.document_category.deleteMany).toHaveBeenCalledWith({
            where: {
                id: "category-1",
                branchId: "branch-1",
                isCustom: true,
            },
        });
    });
});
