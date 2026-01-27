import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";

export type UpdateDocumentParams = {
    id: string;
    updates: {
        name?: string;
        description?: string;
        category?: string;
        tags?: string[];
    };
};

@Injectable()
export class UpdateDocumentUsecase {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
    ) {}

    async execute(params: UpdateDocumentParams): Promise<DocumentEntity> {
        const document = await this.documentRepository.findById(params.id);

        if (!document) {
            throw new NotFoundException("문서를 찾을 수 없습니다.");
        }

        document.update({
            name: params.updates.name,
            description: params.updates.description,
            category: params.updates.category as any,
            tags: params.updates.tags,
        });

        return this.documentRepository.update(document);
    }
}
