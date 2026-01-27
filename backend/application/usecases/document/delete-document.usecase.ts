import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";
import { IFileStoragePort, FILE_STORAGE_PORT } from "domain/ports/file-storage.port";

export type DeleteDocumentParams = {
    id: string;
};

@Injectable()
export class DeleteDocumentUsecase {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
        @Inject(FILE_STORAGE_PORT)
        private readonly fileStorage: IFileStoragePort,
    ) {}

    async execute(params: DeleteDocumentParams): Promise<void> {
        const document = await this.documentRepository.findById(params.id);

        if (!document) {
            throw new NotFoundException("문서를 찾을 수 없습니다.");
        }

        await this.fileStorage.delete(document.storagePath);

        await this.documentRepository.delete(params.id);
    }
}
