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

function toResponse(entity: DocumentEntity) {
    return {
        id: entity.id,
        name: entity.name,
        description: entity.description,
        category: entity.category,
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

@Controller("documents")
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

        // create document record
        const entity = await this.documentService.create({
            name: dto.name || file.originalname,
            description: dto.description,
            category: dto.category,
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

    /**
     * POST /documents
     * Create a new document (metadata only, for existing storage paths)
     */
    @Post()
    async create(@Body() dto: CreateDocumentDto) {
        const entity = await this.documentService.create({
            name: dto.name,
            description: dto.description,
            category: dto.category,
            tags: dto.tags,
            mimetype: dto.mimetype,
            filesize: dto.filesize,
            storagepath: dto.storagepath,
            storageurl: dto.storageurl,
            orgid: dto.orgid,
            uploadedby: dto.uploadedby,
        });
        return toResponse(entity);
    }

    /**
     * GET /documents
     * List all documents
     */
    @Get()
    async findAll() {
        const entities = await this.documentService.findAll();
        return entities.map(toResponse);
    }

    /**
     * GET /documents/:id
     * Find a document by ID
     */
    @Get(":id")
    async findById(@Param("id") id: string) {
        const entity = await this.documentService.findById(id);
        return toResponse(entity);
    }

    /**
     * GET /documents/org/:orgid
     * Find documents by organization ID
     */
    @Get("org/:orgid")
    async findByOrgId(@Param("orgid") orgid: string) {
        const entities = await this.documentService.findByOrgId(orgid);
        return entities.map(toResponse);
    }

    /**
     * GET /documents/category/:category
     * Find documents by category
     */
    @Get("category/:category")
    async findByCategory(@Param("category") category: string) {
        const entities = await this.documentService.findByCategory(category);
        return entities.map(toResponse);
    }

    /**
     * PUT /documents/:id
     * Update a document
     */
    @Put(":id")
    async update(@Param("id") id: string, @Body() dto: UpdateDocumentDto) {
        const entity = await this.documentService.update(id, {
            name: dto.name,
            description: dto.description,
            category: dto.category,
            tags: dto.tags,
            mimetype: dto.mimetype,
            filesize: dto.filesize,
            storagepath: dto.storagepath,
            storageurl: dto.storageurl,
            orgid: dto.orgid,
            uploadedby: dto.uploadedby,
        });
        return toResponse(entity);
    }

    /**
     * DELETE /documents/:id
     * Delete a document (also deletes from storage)
     */
    @Delete(":id")
    async delete(@Param("id") id: string) {
        const doc = await this.documentService.findById(id);
        await this.fileStorage.delete(doc.storagepath);
        await this.documentService.delete(id);
        return { message: "Document deleted successfully" };
    }

     /**
      * GET /documents/:id/download
      * Download a document file
      */
     @Get(":id/download")
     async download(
         @Param("id") id: string,
         @Res() res: Response,
         @Query("attachment") attachment?: string,
     ) {
         const doc = await this.documentService.findById(id);
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
