import { Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EformsignDocMapper } from "infrastructure/database/mapper/eformsign-doc.mapper";

@Injectable()
export class SbEformsignDocRepository implements IEformsignDocRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(organizationid: string, id: number): Promise<EformsignDocEntity | null> {
        const doc = await this.prismaService.eformsign_doc.findFirst({
            where: { id, organization_id: organizationid },
        });
        return doc ? EformsignDocMapper.toDomain(doc) : null;
    }

    async findByDocumentId(organizationid: string, documentId: string): Promise<EformsignDocEntity | null> {
        const doc = await this.prismaService.eformsign_doc.findFirst({
            where: { document_id: documentId, organization_id: organizationid },
        });
        return doc ? EformsignDocMapper.toDomain(doc) : null;
    }

    async findByClientId(organizationid: string, clientId: number): Promise<EformsignDocEntity[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: { client_id: clientId, organization_id: organizationid },
        });
        return docs.map(EformsignDocMapper.toDomain);
    }

    async findAll(organizationid: string): Promise<EformsignDocEntity[]> {
        const docs = await this.prismaService.eformsign_doc.findMany({
            where: { organization_id: organizationid },
        });
        return docs.map(EformsignDocMapper.toDomain);
    }

    async create(organizationid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const created = await this.prismaService.eformsign_doc.create({
            data: {
                ...EformsignDocMapper.toPrismaCreate(doc),
                organization_id: organizationid,
            },
        });
        return EformsignDocMapper.toDomain(created);
    }

    async update(organizationid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        if (!doc.id) {
            throw new Error("Cannot update eformsign_doc without id");
        }
        const result = await this.prismaService.eformsign_doc.updateMany({
            where: { id: doc.id, organization_id: organizationid },
            data: EformsignDocMapper.toPrismaUpdate(doc),
        });
        if (result.count === 0) {
            throw new Error("Eformsign doc not found for organization");
        }
        const updated = await this.prismaService.eformsign_doc.findFirst({
            where: { id: doc.id, organization_id: organizationid },
        });
        if (!updated) {
            throw new Error("Eformsign doc not found after update");
        }
        return EformsignDocMapper.toDomain(updated);
    }

    async upsertByDocumentId(organizationid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity> {
        const data = {
            ...EformsignDocMapper.toPrismaCreate(doc),
            organization_id: organizationid,
        };
        const existing = await this.prismaService.eformsign_doc.findFirst({
            where: { document_id: doc.documentId, organization_id: organizationid },
        });
        if (existing) {
            const result = await this.prismaService.eformsign_doc.updateMany({
                where: { id: existing.id, organization_id: organizationid },
                data,
            });
            if (result.count === 0) {
                throw new Error("Eformsign doc not found for organization");
            }
            const updated = await this.prismaService.eformsign_doc.findFirst({
                where: { id: existing.id, organization_id: organizationid },
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

    async delete(organizationid: string, id: number): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { id, organization_id: organizationid },
        });
    }

    async deleteByDocumentId(organizationid: string, documentId: string): Promise<void> {
        await this.prismaService.eformsign_doc.deleteMany({
            where: { document_id: documentId, organization_id: organizationid },
        });
    }
}
