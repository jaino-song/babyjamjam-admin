import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    Inject,
    Res,
    Query,
} from "@nestjs/common";
import { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentService } from "application/services/document.service";
import { CreateDocumentDto, UpdateDocumentDto, UploadDocumentDto } from "interface/dto/document.dto";
import {
    DocumentEntity,
    allowed_mime_types,
    max_file_size,
} from "domain/entities/document.entity";
import { FILE_STORAGE_PORT, FileStoragePort } from "domain/ports/file-storage.port";
import { v4 as uuidv4 } from "uuid";
import { CurrentTenant } from "infrastructure/tenant";

function toResponse(entity: DocumentEntity) {
    return {
        id: entity.id,
        name: entity.name,
        description: entity.description,
        categoryId: entity.categoryId,
        tags: entity.tags,
        mimeType: entity.mimetype,
        fileSize: entity.filesize,
        storagePath: entity.storagepath,
        storageUrl: entity.storageurl,
        orgId: entity.orgid,
        uploadedBy: entity.uploadedby,
        createdAt: entity.createdat,
        updatedAt: entity.updatedat,
    };
}

@Controller("file-storage")
export class DocumentController {
    constructor(
        private readonly documentService: DocumentService,
        @Inject(FILE_STORAGE_PORT)
        private readonly fileStorage: FileStoragePort,
    ) {}

    /**
     * POST /documents/upload
     * Upload a new document with file
     */
    @Post("upload")
    @UseInterceptors(FileInterceptor("file"))
    async upload(
        @CurrentTenant() tenant: { organizationId?: string },
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: UploadDocumentDto,
    ) {
        if (!file) {
            throw new BadRequestException("file is required");
        }

        // validate file size
        if (!DocumentEntity.validatefilesize(file.size)) {
            throw new BadRequestException(
                `file size exceeds maximum limit of ${max_file_size / (1024 * 1024)}mb`,
            );
        }

        // validate mime type
        if (!DocumentEntity.validatemimetype(file.mimetype)) {
            throw new BadRequestException(
                `invalid file type. allowed types: ${allowed_mime_types.join(", ")}`,
            );
        }

        // generate unique storage path
        const fileExtension = file.originalname.split(".").pop() || "";
        const storagePath = `${uuidv4()}.${fileExtension}`;

        // upload to storage
        const storageUrl = await this.fileStorage.upload(
            file.buffer,
            storagePath,
            file.mimetype,
        );

        // parse tags from string if needed (form-data sends arrays as strings)
        const tags = typeof dto.tags === "string" ? JSON.parse(dto.tags) : dto.tags || [];

        const entity = await this.documentService.create(tenant.organizationId ?? "", {
            name: dto.name || file.originalname,
            description: dto.description,
            categoryId: dto.categoryId,
            tags,
            mimetype: file.mimetype,
            filesize: file.size,
            storagepath: storagePath,
            storageurl: storageUrl,
            orgid: dto.orgid,
            uploadedby: dto.uploadedby || "system",
        });
        return toResponse(entity);
    }

    @Post()
    async create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateDocumentDto) {
        const entity = await this.documentService.create(tenant.organizationId ?? "", {
            name: dto.name,
            description: dto.description,
            categoryId: dto.categoryId,
            tags: dto.tags,
            description: dto.description,
            uploadedBy,
        });
        return toResponse(entity);
    }

    @Get()
    async findAll(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("categoryId") categoryId?: string
    ) {
        const entities = categoryId 
            ? await this.documentService.findByCategoryId(tenant.organizationId ?? "", categoryId) 
            : await this.documentService.findAll(tenant.organizationId ?? "");
        return entities.map(toResponse);
    }

    @Get(":id")
    async findById(@CurrentTenant() tenant: { organizationId?: string }, @Param("id") id: string) {
        const entity = await this.documentService.findById(tenant.organizationId ?? "", id);
        return toResponse(entity);
    }

    /**
     * GET /documents/org/:orgid
     * Find documents by organization ID
     */
    @Get("org/:orgid")
    async findByOrgId(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("orgid") orgid: string
    ) {
        const entities = await this.documentService.findByOrgId(tenant.organizationId ?? "", orgid);
        return entities.map(toResponse);
    }

    @Get("category/:categoryId")
    async findByCategoryId(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("categoryId") categoryId: string
    ) {
        const entities = await this.documentService.findByCategoryId(
            tenant.organizationId ?? "",
            categoryId
        );
        return entities.map(toResponse);
    }

    @Put(":id")
    async update(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateDocumentDto
    ) {
        const entity = await this.documentService.update(tenant.organizationId ?? "", id, {
            name: dto.name,
            description: dto.description,
            categoryId: dto.categoryId,
            tags: dto.tags,
        });
        return toResponse(entity);
    }

    /**
     * DELETE /documents/:id
     * Delete a document (also deletes from storage)
     */
    @Delete(":id")
    async delete(@CurrentTenant() tenant: { organizationId?: string }, @Param("id") id: string) {
        const doc = await this.documentService.findById(tenant.organizationId ?? "", id);
        await this.fileStorage.delete(doc.storagepath);
        await this.documentService.delete(tenant.organizationId ?? "", id);
        return { message: "Document deleted successfully" };
    }

     /**
      * GET /documents/:id/download
      * Download a document file
      */
     @Get(":id/download")
     async download(
         @CurrentTenant() tenant: { organizationId?: string },
         @Param("id") id: string,
         @Res() res: Response,
         @Query("attachment") attachment?: string,
     ) {
         const doc = await this.documentService.findById(tenant.organizationId ?? "", id);
         const fileBuffer = await this.fileStorage.download(doc.storagepath);
         
         // Helper to get extension from mimetype
         const getExtension = (mimetype: string): string => {
             const mimeToExt: Record<string, string> = {
                 "application/pdf": ".pdf",
                 "image/jpeg": ".jpg",
                 "image/png": ".png",
                 "image/gif": ".gif",
                 "image/webp": ".webp",
                 "application/msword": ".doc",
                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
                 "application/vnd.ms-excel": ".xls",
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
             };
             return mimeToExt[mimetype] || "";
         };
         
         // Ensure filename has extension
         let filename = doc.name;
         if (!filename.includes(".")) {
             filename += getExtension(doc.mimetype);
         }
         
         const disposition = attachment === "true" 
             ? `attachment; filename="${encodeURIComponent(filename)}"` 
             : "inline";
         
         res.set({
             "Content-Type": doc.mimetype,
             "Content-Disposition": disposition,
             "Content-Length": fileBuffer.length,
         });
         res.send(fileBuffer);
     }
}
