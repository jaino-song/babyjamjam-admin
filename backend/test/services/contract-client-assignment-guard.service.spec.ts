import { BadRequestException } from "@nestjs/common";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("ContractClientAssignmentGuardService", () => {
    const branchId = "branch-1";
    const createPrisma = () => ({
        employee_schedule: {
            findFirst: jest.fn(),
        },
    });

    it("rejects contract creation when the client has no active assignment", async () => {
        const prisma = createPrisma();
        prisma.employee_schedule.findFirst.mockResolvedValue(null);
        const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

        await expect(
            service.assertAssignedProvider(branchId, 55, "010-1111-2222"),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.employee_schedule.findFirst).toHaveBeenCalledWith({
            where: { clientId: 55, branchId, replaced: false },
            orderBy: { id: "desc" },
            select: {
                id: true,
                primaryEmployee: { select: { phone: true } },
            },
        });
    });

    it("rejects contract creation when the document provider differs from the persisted assignment", async () => {
        const prisma = createPrisma();
        prisma.employee_schedule.findFirst.mockResolvedValue({
            id: 10,
            primaryEmployee: { phone: "010-9999-0000" },
        });
        const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

        await expect(
            service.assertAssignedProvider(branchId, 55, "010-1111-2222"),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts formatting differences for the assigned provider phone", async () => {
        const prisma = createPrisma();
        prisma.employee_schedule.findFirst.mockResolvedValue({
            id: 10,
            primaryEmployee: { phone: "01011112222" },
        });
        const service = new ContractClientAssignmentGuardService(prisma as unknown as PrismaService);

        await expect(
            service.assertAssignedProvider(branchId, 55, "010-1111-2222"),
        ).resolves.toEqual({ scheduleId: 10 });
    });
});
