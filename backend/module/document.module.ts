import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { DocumentRepository } from "infrastructure/database/repositories/sb.document.repository";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { PrismaService } from "infrastructure/database/prisma.service";
import { DocumentService } from "application/services/document.service";
import { DocumentController } from "interface/controllers/document.controller";
import { DocumentCategoryController } from "interface/controllers/document-category.controller";
import { DocumentCategoryService } from "application/services/document-category.service";

@Module({
    imports: [ConfigModule],
    controllers: [DocumentController, DocumentCategoryController],
    providers: [
        DocumentService,
        DocumentCategoryService,
        // Infrastructure
        PrismaService,
        SupabaseStorageAdapter,
        // Repository binding
        {
            provide: DOCUMENT_REPOSITORY,
            useClass: DocumentRepository,
        },
        // File storage binding
        {
            provide: FILE_STORAGE_PORT,
            useClass: SupabaseStorageAdapter,
        },
    ],
    exports: [DocumentService],
})
export class DocumentModule {}
