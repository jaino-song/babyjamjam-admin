import { Injectable } from "@nestjs/common";

import type {
    IContractSupersedeRepository,
    SupersedeCandidateDocument,
} from "domain/repositories/contract-supersede.repository.interface";
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
}
