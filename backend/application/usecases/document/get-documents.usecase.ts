import { Inject, Injectable } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { DocumentFilter, IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";

export type GetDocumentsParams = {
    filter?: DocumentFilter;
};

@Injectable()
export class GetDocumentsUsecase {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
    ) {}

    async execute(params: GetDocumentsParams): Promise<DocumentEntity[]> {
        return this.documentRepository.findAll(params.filter);
    }
}
