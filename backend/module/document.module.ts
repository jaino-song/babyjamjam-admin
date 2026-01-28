import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";
import { FILE_STORAGE_PORT } from "domain/ports/file-storage.port";
import { SbDocumentRepository } from "infrastructure/database/repositories/sb.document.repository";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { PrismaService } from "infrastructure/database/prisma.service";
import { DocumentService } from "application/services/document.service";
import { DocumentController } from "interface/controllers/document.controller";

@Module({
    imports: [ConfigModule],
    controllers: [DocumentController],
    providers: [
        // Service
        DocumentService,
        // Infrastructure
        PrismaService,
        SupabaseStorageAdapter,
        // Repository binding
        {
            provide: DOCUMENT_REPOSITORY,
            useClass: SbDocumentRepository,
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
