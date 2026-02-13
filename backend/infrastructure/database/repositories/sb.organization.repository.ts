import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IOrganizationRepository } from "domain/repositories/organization.repository.interface";

@Injectable()
export class SbOrganizationRepository implements IOrganizationRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findAllActive(): Promise<{ id: string; name: string }[]> {
        return this.prisma.organization.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
        });
    }
}
