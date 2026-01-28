import { Prisma } from '@prisma/client';
import { DocumentEntity, AllowedMimeType, DocumentCategory } from 'domain/entities/document.entity';

type DocumentRow = {
    id: string;
    name: string;
    description: string | null;
    categoryId: string;
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

export class DocumentMapper {
    static toDomain(row: DocumentRow): DocumentEntity {
        return DocumentEntity.reconstitute({
            id: row.id,
            name: row.name,
            description: row.description ?? undefined,
            categoryId: row.categoryId,
            tags: row.tags,
            mimetype: row.mimeType,
            filesize: row.fileSize,
            storagepath: row.storagePath,
            storageurl: row.storageUrl ?? undefined,
            orgid: row.orgId ?? undefined,
            uploadedby: row.uploadedBy,
            createdat: row.createdAt,
            updatedat: row.updatedAt,
        });
    }

    static toPrismaCreate(entity: DocumentEntity): Prisma.documentCreateInput {
        const input: Prisma.documentCreateInput = {
            name: entity.name,
            description: entity.description ?? null,
            categoryId: entity.categoryId,
            tags: entity.tags,
            mimeType: entity.mimeType,
            fileSize: entity.fileSize,
            storagePath: entity.storagePath,
            orgId: entity.orgId ?? undefined,
            uploadedBy: entity.uploadedBy,
        };
        
        if (entity.storageUrl !== null) {
            input.storageUrl = entity.storageUrl;
        }
        
        return input;
    }

    static toPrismaUpdate(entity: DocumentEntity): Prisma.documentUpdateInput {
        return {
            name: entity.name,
            description: entity.description ?? null,
            categoryId: entity.categoryId,
            tags: entity.tags,
        };
    }
}
