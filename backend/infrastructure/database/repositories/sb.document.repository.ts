import { Injectable } from "@nestjs/common";
import { IDocumentRepository, DocumentFilter } from "domain/repositories/document.repository.interface";
import { DocumentEntity } from "domain/entities/document.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { DocumentMapper } from "infrastructure/database/mapper/document.mapper";

type PrismaDocumentRow = {
    id: string;
    name: string;
    description: string | null;
    category: string;
    tags: string[];
    mime_type: string;
    file_size: number;
    storage_path: string;
    storage_url: string | null;
    org_id: string | null;
    uploaded_by: string;
    created_at: Date;
    updated_at: Date;
};

@Injectable()
export class DocumentRepository implements IDocumentRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(organizationid: string, id: string): Promise<DocumentEntity | null> {
        const doc = await this.prismaService.document.findFirst({
            where: { id, organization_id: organizationid },
        });
        return doc ? DocumentMapper.toDomain(doc) : null;
    }

    async findByOrgId(organizationid: string, orgid: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: { orgId: orgid, organization_id: organizationid },
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async findByCategoryId(organizationid: string, categoryId: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: { categoryId, organization_id: organizationid },
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async findAll(organizationid: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: { organization_id: organizationid },
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async create(organizationid: string, doc: DocumentEntity): Promise<DocumentEntity> {
        const created = await this.prismaService.document.create({
            data: {
                ...DocumentMapper.toPrismaCreate(doc),
                organization_id: organizationid,
            },
        });
        return DocumentMapper.toDomain(created);
    }

    async update(organizationid: string, doc: DocumentEntity): Promise<DocumentEntity> {
        if (!doc.id) {
            throw new Error("Cannot update document without id");
        }
        const result = await this.prismaService.document.updateMany({
            where: { id: doc.id, organization_id: organizationid },
            data: DocumentMapper.toPrismaUpdate(doc),
        });
        if (result.count === 0) {
            throw new Error("Document not found for organization");
        }
        const updated = await this.prismaService.document.findFirst({
            where: { id: doc.id, organization_id: organizationid },
        });
        if (!updated) {
            throw new Error("Document not found after update");
        }
        return DocumentMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: string): Promise<void> {
        await this.prismaService.document.deleteMany({
            where: { id, organization_id: organizationid },
        });
    }
}
