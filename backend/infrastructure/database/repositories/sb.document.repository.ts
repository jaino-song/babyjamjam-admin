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

    private toMapperFormat(row: PrismaDocumentRow) {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            category: row.category,
            tags: row.tags,
            mime_type: row.mime_type,
            file_size: row.file_size,
            storage_path: row.storage_path,
            storage_url: row.storage_url,
            org_id: row.org_id,
            uploaded_by: row.uploaded_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }

    async findById(id: string): Promise<DocumentEntity | null> {
        const row = await this.prismaService.document.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                description: true,
                category: true,
                tags: true,
                mimeType: true,
                fileSize: true,
                storagePath: true,
                storageUrl: true,
                orgId: true,
                uploadedBy: true,
                createdAt: true,
                updatedAt: true,
            },
        }) as any;
        if (!row) return null;
        
        return DocumentMapper.toDomain(this.toMapperFormat(row));
    }

    async findAll(filter?: DocumentFilter): Promise<DocumentEntity[]> {
        const where: any = {};
        if (filter?.category) where.category = filter.category;
        if (filter?.tags?.length) where.tags = { hasSome: filter.tags };
        if (filter?.uploadedBy) where.uploadedBy = filter.uploadedBy;
        if (filter?.orgId) where.orgId = filter.orgId;

        const rows = await this.prismaService.document.findMany({
            where,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                description: true,
                category: true,
                tags: true,
                mimeType: true,
                fileSize: true,
                storagePath: true,
                storageUrl: true,
                orgId: true,
                uploadedBy: true,
                createdAt: true,
                updatedAt: true,
            },
        }) as any;
        
        return rows.map((row: any) => DocumentMapper.toDomain(this.toMapperFormat(row)));
    }

    async findByCategoryId(categoryId: string): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany({
            where: { categoryId },
        });
        return docs.map(DocumentMapper.toDomain);
    }

    async findAll(): Promise<DocumentEntity[]> {
        const docs = await this.prismaService.document.findMany();
        return docs.map(DocumentMapper.toDomain);
    }

    async create(doc: DocumentEntity): Promise<DocumentEntity> {
        const created = await this.prismaService.document.create({
            data: DocumentMapper.toPrismaCreate(document),
            select: {
                id: true,
                name: true,
                description: true,
                category: true,
                tags: true,
                mimeType: true,
                fileSize: true,
                storagePath: true,
                storageUrl: true,
                orgId: true,
                uploadedBy: true,
                createdAt: true,
                updatedAt: true,
            },
        }) as any;
        
        return DocumentMapper.toDomain(this.toMapperFormat(created));
    }

    async update(document: DocumentEntity): Promise<DocumentEntity> {
        const updated = await this.prismaService.document.update({
            where: { id: document.id },
            data: DocumentMapper.toPrismaUpdate(document),
            select: {
                id: true,
                name: true,
                description: true,
                category: true,
                tags: true,
                mimeType: true,
                fileSize: true,
                storagePath: true,
                storageUrl: true,
                orgId: true,
                uploadedBy: true,
                createdAt: true,
                updatedAt: true,
            },
        }) as any;
        
        return DocumentMapper.toDomain(this.toMapperFormat(updated));
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.document.delete({
            where: { id },
        });
    }
}
