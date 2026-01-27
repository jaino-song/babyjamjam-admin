// 허용된 MIME 타입 상수
export const ALLOWED_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/pdf',
] as const;

// 최대 파일 크기 (25MB)
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

// 문서 카테고리 상수
export const PREDEFINED_CATEGORIES = [
    'contract',
    'invoice',
    'receipt',
    'report',
    'certificate',
    'form',
    'notice',
    'employeecontract',
] as const;

export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];
export type DocumentCategory = typeof PREDEFINED_CATEGORIES[number];

interface CreateDocumentProps {
    name: string;
    description?: string;
    category: DocumentCategory;
    tags: string[];
    mimeType: AllowedMimeType;
    fileSize: number;
    storagePath: string;
    storageUrl: string | null;
    orgId?: string | null;
    uploadedBy: string;
}

interface UpdateDocumentProps {
    name?: string;
    description?: string;
    category?: DocumentCategory;
    tags?: string[];
}

export class DocumentEntity {
    constructor(
        public readonly id: string,
        public name: string,
        public description: string | null,
        public category: DocumentCategory,
        public tags: string[],
        public readonly mimeType: AllowedMimeType,
        public readonly fileSize: number,
        public readonly storagePath: string,
        public readonly storageUrl: string | null,
        public readonly orgId: string | null,
        public readonly uploadedBy: string,
        public readonly createdAt: Date,
        public updatedAt: Date,
    ) {}

    // 파일 크기 검증
    static validateFileSize(size: number): boolean {
        return size > 0 && size <= MAX_FILE_SIZE;
    }

    // MIME 타입 검증
    static validateMimeType(mimeType: string): mimeType is AllowedMimeType {
        return ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType);
    }

    // 카테고리 검증
    static validateCategory(category: string): category is DocumentCategory {
        return PREDEFINED_CATEGORIES.includes(category as DocumentCategory);
    }

    // 메타데이터만 업데이트 (파일 자체는 불변)
    update(props: UpdateDocumentProps): void {
        if (props.name !== undefined) this.name = props.name;
        if (props.description !== undefined) this.description = props.description;
        if (props.category !== undefined) {
            if (!DocumentEntity.validateCategory(props.category)) {
                throw new Error(`유효하지 않은 카테고리: ${props.category}`);
            }
            this.category = props.category;
        }
        if (props.tags !== undefined) this.tags = props.tags;
        this.updatedAt = new Date();
    }

    // 새 문서 생성
    static create(props: CreateDocumentProps): DocumentEntity {
        // 검증
        if (!DocumentEntity.validateFileSize(props.fileSize)) {
            throw new Error(`파일 크기가 제한을 초과했습니다. 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB`);
        }
        if (!DocumentEntity.validateMimeType(props.mimeType)) {
            throw new Error(`허용되지 않은 파일 형식: ${props.mimeType}`);
        }
        if (!DocumentEntity.validateCategory(props.category)) {
            throw new Error(`유효하지 않은 카테고리: ${props.category}`);
        }

        const now = new Date();
        return new DocumentEntity(
            '',
            props.name,
            props.description ?? null,
            props.category,
            props.tags,
            props.mimeType,
            props.fileSize,
            props.storagePath,
            props.storageUrl,
            props.orgId ?? null,
            props.uploadedBy,
            now,
            now,
        );
    }

    // DB에서 재구성
    static reconstitute(
        id: string,
        name: string,
        description: string | null,
        category: DocumentCategory,
        tags: string[],
        mimeType: AllowedMimeType,
        fileSize: number,
        storagePath: string,
        storageUrl: string | null,
        orgId: string | null,
        uploadedBy: string,
        createdAt: Date,
        updatedAt: Date,
    ): DocumentEntity {
        return new DocumentEntity(
            id,
            name,
            description,
            category,
            tags,
            mimeType,
            fileSize,
            storagePath,
            storageUrl,
            orgId,
            uploadedBy,
            createdAt,
            updatedAt,
        );
    }
}
