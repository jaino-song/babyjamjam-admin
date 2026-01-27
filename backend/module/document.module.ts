import { Module } from "@nestjs/common";
import { DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";
import { SbDocumentRepository } from "infrastructure/database/repositories/sb.document.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { DocumentService } from "application/services/document.service";
import { DocumentController } from "interface/controllers/document.controller";

@Module({
    controllers: [DocumentController],
    providers: [
        // Service
        DocumentService,
        // Infrastructure
        PrismaService,
        // Repository binding
        {
            provide: DOCUMENT_REPOSITORY,
            useClass: SbDocumentRepository,
        },
    ],
    exports: [DocumentService],
})
export class DocumentModule {}
