import { BadRequestException, Injectable } from "@nestjs/common";
import { normalizePhone } from "application/utils/normalize-phone";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class ContractClientAssignmentGuardService {
    constructor(private readonly prisma: PrismaService) {}

    async assertAssignedClient(branchId: string, clientId: number): Promise<{ scheduleId: number }> {
        const schedule = await this.findActiveSchedule(branchId, clientId);
        if (!schedule) {
            throw new BadRequestException("고객의 제공인력 배정을 먼저 저장해 주세요.");
        }
        return { scheduleId: schedule.id };
    }

    async assertAssignedProvider(
        branchId: string,
        clientId: number,
        providerPhone: string | null | undefined,
    ): Promise<{ scheduleId: number }> {
        const schedule = await this.findActiveSchedule(branchId, clientId);
        if (!schedule) {
            throw new BadRequestException("고객의 제공인력 배정을 먼저 저장해 주세요.");
        }

        const expectedPhone = normalizePhone(providerPhone ?? null);
        const assignedPhone = normalizePhone(schedule.primaryEmployee.phone);
        if (!expectedPhone || !assignedPhone || expectedPhone !== assignedPhone) {
            throw new BadRequestException("전자문서의 제공인력과 고객 배정 정보가 일치하지 않습니다.");
        }
        return { scheduleId: schedule.id };
    }

    private findActiveSchedule(branchId: string, clientId: number) {
        return this.prisma.employee_schedule.findFirst({
            where: { clientId, branchId, replaced: false },
            orderBy: { id: "desc" },
            select: {
                id: true,
                primaryEmployee: { select: { phone: true } },
            },
        });
    }
}
