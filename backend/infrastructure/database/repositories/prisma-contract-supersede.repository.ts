import { Injectable } from "@nestjs/common";

import type {
    IContractSupersedeRepository,
    SupersedeCandidateDocument,
} from "domain/repositories/contract-supersede.repository.interface";
import { INCHEON_STAFF_BRANCH_SLUG } from "domain/constants/branch-routing.constants";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class PrismaContractSupersedeRepository implements IContractSupersedeRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findSupersedeCandidate(documentId: string): Promise<SupersedeCandidateDocument | null> {
        return this.prisma.eformsign_doc.findUnique({
            where: { documentId },
            select: {
                clientId: true, documentKind: true,
                statusType: true, stepType: true, stepName: true,
            },
        });
    }

    async isHeadquartersBranch(branchId: string): Promise<boolean> {
        if (!branchId) {
            return false;
        }
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { slug: true },
        });
        return branch?.slug === INCHEON_STAFF_BRANCH_SLUG;
    }
}
