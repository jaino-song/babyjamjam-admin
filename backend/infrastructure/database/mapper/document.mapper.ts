import { DocumentEntity } from "domain/entities/document.entity";

type DocumentRow = {
    id: string;
    name: string;
    description: string | null;
    category: string;
    tags: string[];
    mimeType: string;
    fileSize: number;
    storagePath: string;
    storageUrl: string | null;
    orgId: string | null;
    uploadedBy: string;
    createdAt: Date;
    updatedAt: Date;
};

export class DocumentMapper {
    static toDomain(row: DocumentRow): DocumentEntity {
        return DocumentEntity.reconstitute({
            id: row.id,
            name: row.name,
            description: row.description ?? undefined,
            category: row.category,
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

    static toPrismaCreate(entity: DocumentEntity) {
        return {
            name: entity.name,
            description: entity.description ?? null,
            category: entity.category,
            tags: entity.tags,
            mimeType: entity.mimetype,
            fileSize: entity.filesize,
            storagePath: entity.storagepath,
            storageUrl: entity.storageurl ?? null,
            orgId: entity.orgid ?? null,
            uploadedBy: entity.uploadedby,
            createdAt: entity.createdat,
            updatedAt: entity.updatedat,
        };
    }

    static toPrismaUpdate(entity: DocumentEntity) {
        return {
            name: entity.name,
            description: entity.description ?? null,
            category: entity.category,
            tags: entity.tags,
            mimeType: entity.mimetype,
            fileSize: entity.filesize,
            storagePath: entity.storagepath,
            storageUrl: entity.storageurl ?? null,
            orgId: entity.orgid ?? null,
            uploadedBy: entity.uploadedby,
            updatedAt: entity.updatedat,
        };
    }
}
