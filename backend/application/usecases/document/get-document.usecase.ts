import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";

export type GetDocumentParams = {
    id: string;
};

@Injectable()
export class GetDocumentUsecase {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
    ) {}

    async execute(params: GetDocumentParams): Promise<DocumentEntity> {
        const document = await this.documentRepository.findById(params.id);

        if (!document) {
            throw new NotFoundException("문서를 찾을 수 없습니다.");
        }

        return document;
    }
}
