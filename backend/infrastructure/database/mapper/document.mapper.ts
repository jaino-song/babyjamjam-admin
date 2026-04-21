import { Prisma, document as PrismaDocument } from '@prisma/client';
import { DocumentEntity } from 'domain/entities/document.entity';

// Use Prisma's generated type directly
type DocumentRow = PrismaDocument;

export class DocumentMapper {
    static toDomain(row: DocumentRow): DocumentEntity {
        return DocumentEntity.reconstitute(
            row.id,
            row.name,
            row.description ?? null,
            row.categoryId,
            row.tags,
            row.mimeType,
            row.fileSize,
            row.storagePath,
            row.storageUrl ?? null,
            row.orgId ?? null,
            row.uploadedBy,
            row.createdAt,
            row.updatedAt,
        );
    }

    static toPrismaCreate(entity: DocumentEntity): Omit<Prisma.documentUncheckedCreateInput, 'branchId'> {
        const now = new Date();
        return {
            name: entity.name,
            description: entity.description ?? null,
            categoryId: entity.categoryId,
            tags: entity.tags,
            mimeType: entity.mimeType,
            fileSize: entity.fileSize,
            storagePath: entity.storagePath,
            storageUrl: entity.storageUrl,
            orgId: entity.orgId,
            uploadedBy: entity.uploadedBy,
            updatedAt: now,
        };
    }

    static toPrismaUpdate(entity: DocumentEntity): Prisma.documentUncheckedUpdateInput {
        return {
            name: entity.name,
            description: entity.description ?? null,
            categoryId: entity.categoryId,
            tags: entity.tags,
            updatedAt: new Date(),
        };
    }
}
