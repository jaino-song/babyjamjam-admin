import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IDocumentRepository, DOCUMENT_REPOSITORY } from 'domain/repositories/document.repository.interface';
import { IFileStoragePort, FILE_STORAGE_PORT } from 'domain/ports/file-storage.port';

export interface DownloadDocumentResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

@Injectable()
export class DownloadDocumentUsecase {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: IDocumentRepository,
    @Inject(FILE_STORAGE_PORT)
    private readonly fileStorage: IFileStoragePort,
  ) {}

  async execute(id: string): Promise<DownloadDocumentResult> {
    const document = await this.documentRepository.findById(id);
    
    if (!document) {
      throw new NotFoundException(`Document not found: ${id}`);
    }
    
    const buffer = await this.fileStorage.download(document.storagePath);
    
    return {
      buffer,
      mimeType: document.mimeType,
      filename: document.name,
    };
  }
}
