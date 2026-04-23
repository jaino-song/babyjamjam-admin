import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IBranchRepository } from "domain/repositories/branch.repository.interface";

@Injectable()
export class SbBranchRepository implements IBranchRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findAllActive(): Promise<{ id: string; name: string }[]> {
        return this.prisma.branch.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
        });
    }
}
