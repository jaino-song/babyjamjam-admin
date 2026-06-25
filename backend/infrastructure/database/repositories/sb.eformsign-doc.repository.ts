import { Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignDocCompletionClaimParams,
    EformsignDocCompletionClaimResult,
    EformsignDocClientSummary,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";

@Injectable()
export class SbEformsignDocRepository implements IEformsignDocRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(branchid: string, id: number): Promise<EformsignDocEntity | null> {
        const doc = await this.prismaService.eformsign_doc.findFirst({
            where: { id, branchId: branchid },
        });
        return doc ? EformsignDocMapper.toDomain(doc) : null;
    }

    async findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null> {
        const doc = await this.prismaService.eformsign_doc.findFirst({
            where: { documentId: documentId, branchId: branchid },
        });
        return doc ? EformsignDocMapper.toDomain(doc) : null;
    }

    async findBranchIdByDocumentId(documentId: string): Promise<string | null> {
        const doc = await this.prismaService.eformsign_doc.findUnique({
            where: { documentId },
            select: { branchId: true },
        });
        return doc?.branchId ?? null;
    }

    async claimCompletionStatus(
        branchid: string,
        params: EformsignDocCompletionClaimParams,
    ): Promise<EformsignDocCompletionClaimResult> {
        const result = await this.prismaService.eformsign_doc.updateMany({
            where: {
                branchId: branchid,
                documentId: params.documentId,
                statusType: { not: params.statusType },
            },
            data: {
                statusType: params.statusType,
                statusDetail: params.statusDetail,
                stepType: params.stepType,
                stepIndex: params.stepIndex,
                stepName: params.stepName,
                expired: params.expired,
                updatedDate: new Date(),
            },
        });

        if (result.count === 1) {
            return "claimed";
        }

        const existing = await this.prismaService.eformsign_doc.findFirst({
            where: {
                branchId: branchid,
                documentId: params.documentId,
            },
            select: { id: true },
        });

        return existing ? "duplicate" : "missing";
    }

    async findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: { clientId: clientId, branchId: branchid },
        });
        return docs.map(EformsignDocMapper.toDomain);
    }

    async findAll(branchid: string): Promise<EformsignDocEntity[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: { branchId: branchid },
        });
        return docs.map(EformsignDocMapper.toDomain);
    }

    async findDocumentIdsForOtherBranches(branchid: string): Promise<string[]> {
        // 다른 지점이 소유한 문서의 documentId만 추린다. branchId가 null인(미적재) 문서는
        // "지점 미지정"이라 인천(본사) 목록에 남아야 하므로 제외한다. Prisma의 `not`은
        // null을 포함하므로 `not: null`로 비-null을 명시적으로 강제한다.
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: {
                branchId: { not: null },
                NOT: { branchId: branchid },
            },
            select: { documentId: true },
        });
        return docs.map((doc) => doc.documentId);
    }

    async findClientNamesByBranch(branchid: string): Promise<EformsignDocClientSummary[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: { branchId: branchid },
            select: { documentId: true, clientId: true, stepRecipientName: true },
        });
        const clientIds = Array.from(
            new Set(docs.map((d) => d.clientId).filter((id): id is number => id != null)),
        );
        if (clientIds.length === 0) return [];
        const clients = await this.prismaService.client.findMany({
            where: { id: { in: clientIds } },
            select: { id: true, name: true, phone: true },
        });
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: {
                clientId: { in: clientIds },
                branchId: branchid,
                replaced: false,
            },
            include: {
                primaryEmployee: true,
            },
            orderBy: { id: "desc" },
        });
        const clientById = new Map(clients.map((c) => [c.id, c]));
        const providerByClientId = new Map<number, string>();
        for (const schedule of schedules) {
            if (!providerByClientId.has(schedule.clientId)) {
                providerByClientId.set(schedule.clientId, schedule.primaryEmployee.name);
            }
        }
        return docs
            .filter((d) => d.documentId && d.clientId != null && clientById.has(d.clientId))
            .map((d) => {
                const client = clientById.get(d.clientId!)!;
                const contractRecipientName = d.stepRecipientName.trim();
                return {
                    documentId: d.documentId,
                    clientId: client.id,
                    clientName: contractRecipientName || client.name,
                    clientPhone: client.phone ?? null,
                    providerName: providerByClientId.get(d.clientId!) ?? null,
                };
            });
    }

    async create(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const created = await this.prismaService.eformsign_doc.create({
            data: {
                ...EformsignDocMapper.toPrismaCreate(doc),
                branchId: branchid,
            },
        });
        return EformsignDocMapper.toDomain(created);
    }

    async update(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        if (!doc.id) {
            throw new Error("Cannot update eformsign_doc without id");
        }
        const result = await this.prismaService.eformsign_doc.updateMany({
            where: { id: doc.id, branchId: branchid },
            data: EformsignDocMapper.toPrismaUpdate(doc),
        });
        if (result.count === 0) {
            throw new Error("Eformsign doc not found for branch");
        }
        const updated = await this.prismaService.eformsign_doc.findFirst({
            where: { id: doc.id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Eformsign doc not found after update");
        }
        return EformsignDocMapper.toDomain(updated);
    }

    async upsertByDocumentId(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const data = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            branchId: branchid,
        };
        const existing = await this.prismaService.eformsign_doc.findFirst({
            where: { documentId: doc.documentId, branchId: branchid },
        });
        if (existing) {
            const result = await this.prismaService.eformsign_doc.updateMany({
                where: { id: existing.id, branchId: branchid },
                data,
            });
            if (result.count === 0) {
                throw new Error("Eformsign doc not found for branch");
            }
            const updated = await this.prismaService.eformsign_doc.findFirst({
                where: { id: existing.id, branchId: branchid },
            });
            if (!updated) {
                throw new Error("Eformsign doc not found after update");
            }
            return EformsignDocMapper.toDomain(updated);
        }
        const created = await this.prismaService.eformsign_doc.create({
            data,
        });
        return EformsignDocMapper.toDomain(created);
    }

    async delete(branchid: string, id: number): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { id, branchId: branchid },
        });
    }

    async deleteByDocumentId(branchid: string, documentId: string): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { documentId: documentId, branchId: branchid },
        });
    }
}
