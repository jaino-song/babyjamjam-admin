import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { DocumentService } from "application/services/document.service";
import { CreateDocumentDto, UpdateDocumentDto } from "interface/dto/document.dto";

@Controller("documents")
export class DocumentController {
    constructor(private readonly documentService: DocumentService) {}

    /**
     * POST /documents
     * Create a new document
     */
    @Post()
    async create(@Body() dto: CreateDocumentDto) {
        return this.documentService.create({
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
    }

    /**
     * GET /documents
     * List all documents
     */
    @Get()
    async findAll() {
        return this.documentService.findAll();
    }

    /**
     * GET /documents/:id
     * Find a document by ID
     */
    @Get(":id")
    async findById(@Param("id") id: string) {
        return this.documentService.findById(id);
    }

    /**
     * GET /documents/org/:orgid
     * Find documents by organization ID
     */
    @Get("org/:orgid")
    async findByOrgId(@Param("orgid") orgid: string) {
        return this.documentService.findByOrgId(orgid);
    }

    /**
     * GET /documents/category/:category
     * Find documents by category
     */
    @Get("category/:category")
    async findByCategory(@Param("category") category: string) {
        return this.documentService.findByCategory(category);
    }

    /**
     * PUT /documents/:id
     * Update a document
     */
    @Put(":id")
    async update(@Param("id") id: string, @Body() dto: UpdateDocumentDto) {
        return this.documentService.update(id, {
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
    }

    /**
     * DELETE /documents/:id
     * Delete a document
     */
    @Delete(":id")
    async delete(@Param("id") id: string) {
        await this.documentService.delete(id);
        return { message: "Document deleted successfully" };
    }
}
