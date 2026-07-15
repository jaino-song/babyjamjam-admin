import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IBranchRepository } from "domain/repositories/branch.repository.interface";
import { isVisibleStaffBranchSlug } from "domain/constants/branch-routing.constants";

@Injectable()
export class SbBranchRepository implements IBranchRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findAllActive(): Promise<{ id: string; name: string }[]> {
        const branches = await this.prisma.branch.findMany({
            where: { isActive: true },
            select: { id: true, name: true, slug: true },
        });

        return branches
            .filter((branch) => isVisibleStaffBranchSlug(branch.slug))
            .map(({ id, name }) => ({ id, name }));
    }
}
