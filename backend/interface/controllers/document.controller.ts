import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    StreamableFile,
    UploadedFile,
    UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentService } from "application/services/document.service";
import {
    CreateDocumentDto,
    UpdateDocumentDto,
    DocumentFilterDto,
} from "interface/dto/document.dto";
import { Request } from "express";
import { DownloadDocumentUsecase } from "application/usecases/document/download-document.usecase";

@Controller("file-storage")
export class DocumentController {
    constructor(
        private readonly documentService: DocumentService,
        private readonly downloadUseCase: DownloadDocumentUsecase,
    ) {}

    @Post()
    @UseInterceptors(FileInterceptor("file"))
    upload(
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: CreateDocumentDto,
        @Req() req: Request,
    ) {
        const uploadedBy = (req as any).user?.id ?? "anonymous";
        
        return this.documentService.upload({
            file: file.buffer,
            filename: file.originalname,
            mimetype: file.mimetype,
            filesize: file.size,
            category: dto.category,
            tags: dto.tags,
            description: dto.description,
            uploadedBy,
        });
    }

    @Get()
    list(@Query() filter: DocumentFilterDto) {
        return this.documentService.list({
            category: filter.category,
            tags: filter.tags,
            uploadedBy: filter.uploadedBy,
            orgId: filter.orgId,
        });
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.documentService.findById(id);
    }

    @Patch(":id")
    update(@Param("id") id: string, @Body() dto: UpdateDocumentDto) {
        return this.documentService.update(id, {
            name: dto.name,
            description: dto.description,
            category: dto.category,
            tags: dto.tags,
        });
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.documentService.delete(id);
    }

    @Get(":id/download")
    async download(
        @Param("id") id: string,
        @Query("attachment") attachment?: string,
    ): Promise<StreamableFile> {
        const { buffer, mimeType, filename } = await this.downloadUseCase.execute(id);
        
        const dispositionType = attachment === "true" ? "attachment" : "inline";
        const encodedFilename = encodeURIComponent(filename);
        
        return new StreamableFile(buffer, {
            type: mimeType,
            disposition: `${dispositionType}; filename="${encodedFilename}"`,
            length: buffer.length,
        });
    }
}
