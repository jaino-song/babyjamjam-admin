import { Injectable } from "@nestjs/common";
import {
    UploadDocumentUsecase,
    UploadDocumentParams,
    GetDocumentsUsecase,
    GetDocumentUsecase,
    UpdateDocumentUsecase,
    DeleteDocumentUsecase,
} from "application/usecases/document";
import { DocumentEntity } from "domain/entities/document.entity";
import { DocumentFilter } from "domain/repositories/document.repository.interface";

@Injectable()
export class DocumentService {
    constructor(
        private readonly uploadDocumentUsecase: UploadDocumentUsecase,
        private readonly getDocumentsUsecase: GetDocumentsUsecase,
        private readonly getDocumentUsecase: GetDocumentUsecase,
        private readonly updateDocumentUsecase: UpdateDocumentUsecase,
        private readonly deleteDocumentUsecase: DeleteDocumentUsecase,
    ) {}

    upload(params: UploadDocumentParams): Promise<DocumentEntity> {
        return this.uploadDocumentUsecase.execute(params);
    }

    list(filter?: DocumentFilter): Promise<DocumentEntity[]> {
        return this.getDocumentsUsecase.execute({ filter });
    }

    findById(id: string): Promise<DocumentEntity> {
        return this.getDocumentUsecase.execute({ id });
    }

    update(
        id: string,
        updates: {
            name?: string;
            description?: string;
            category?: string;
            tags?: string[];
        },
    ): Promise<DocumentEntity> {
        return this.updateDocumentUsecase.execute({ id, updates });
    }

    delete(id: string): Promise<void> {
        return this.deleteDocumentUsecase.execute({ id });
    }
}
