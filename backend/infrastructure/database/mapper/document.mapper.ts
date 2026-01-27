import { Prisma } from '@prisma/client';
import { DocumentEntity, AllowedMimeType, DocumentCategory } from 'domain/entities/document.entity';

type DocumentRow = {
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

export class DocumentMapper {
    static toDomain(row: DocumentRow): DocumentEntity {
        return DocumentEntity.reconstitute(
            row.id,
            row.name,
            row.description,
            row.category as DocumentCategory,
            row.tags,
            row.mime_type as AllowedMimeType,
            row.file_size,
            row.storage_path,
            row.storage_url,
            row.org_id as string | null,
            row.uploaded_by,
            row.created_at,
            row.updated_at,
        );
    }

    static toPrismaCreate(entity: DocumentEntity): Prisma.documentCreateInput {
        const input: Prisma.documentCreateInput = {
            name: entity.name,
            description: entity.description ?? undefined,
            category: entity.category,
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
            description: entity.description ?? undefined,
            category: entity.category,
            tags: entity.tags,
        };
    }
}
