// allowed mime types for upload
export const allowed_mime_types = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/pdf',
] as const;

export type allowedmimetype = typeof allowed_mime_types[number];

// maximum file size (25mb in bytes)
export const max_file_size = 25 * 1024 * 1024;

// predefined document categories
export const predefined_categories = [
    'contract',
    'invoice',
    'receipt',
    'report',
    'certificate',
    'form',
    'notice',
    'employee-contract',
] as const;

export type documentcategory = typeof predefined_categories[number];

interface DocumentProps {
    id?: string;
    name: string;
    description?: string;
    categoryId: string;
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

    /**
     * Invariants = rules that must always be true for this entity to be valid.
     * Enforce them once here so the rest of your code can trust the entity.
     */
    private assertInvariants(): void {
        if (!this.props.name) throw new Error("DocumentEntity: name is required");
        if (!this.props.categoryId) throw new Error("DocumentEntity: categoryId is required");
        if (!Array.isArray(this.props.tags)) throw new Error("DocumentEntity: tags must be an array");
        if (!this.props.mimetype) throw new Error("DocumentEntity: mimetype is required");
        if (typeof this.props.filesize !== "number" || this.props.filesize < 0) {
            throw new Error("DocumentEntity: filesize must be a non-negative number");
        }
        if (!this.props.storagepath) throw new Error("DocumentEntity: storagepath is required");
        if (!this.props.uploadedby) throw new Error("DocumentEntity: uploadedby is required");

        if (!(this.props.createdat instanceof Date) || Number.isNaN(this.props.createdat.getTime())) {
            throw new Error("DocumentEntity: createdat must be a valid Date");
        }
        if (!(this.props.updatedat instanceof Date) || Number.isNaN(this.props.updatedat.getTime())) {
            throw new Error("DocumentEntity: updatedat must be a valid Date");
        }
        if (this.props.updatedat < this.props.createdat) {
            throw new Error("DocumentEntity: updatedat cannot be before createdat");
        }
    }

    // Accessors (optional, but keeps props encapsulated)
    get id(): string | undefined { return this.props.id; }
    get name(): string { return this.props.name; }
    get description(): string | undefined { return this.props.description; }
    get categoryId(): string { return this.props.categoryId; }
    get tags(): string[] { return this.props.tags; }
    get mimetype(): string { return this.props.mimetype; }
    get filesize(): number { return this.props.filesize; }
    get storagepath(): string { return this.props.storagepath; }
    get storageurl(): string | undefined { return this.props.storageurl; }
    get orgid(): string | undefined { return this.props.orgid; }
    get uploadedby(): string { return this.props.uploadedby; }
    get createdat(): Date { return this.props.createdat; }
    get updatedat(): Date { return this.props.updatedat; }

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

    static validatefilesize(size: number): boolean {
        return size > 0 && size <= max_file_size;
    }

    static validatemimetype(mimetype: string): boolean {
        return allowed_mime_types.includes(mimetype as allowedmimetype);
    }

    static validatecategory(category: string): boolean {
        return predefined_categories.includes(category as documentcategory);
    }
}
