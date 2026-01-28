import { Controller, Get, Post, Delete, Body, Param } from "@nestjs/common";
import { IsString } from "class-validator";
import { DocumentCategoryService, DocumentCategory } from "application/services/document-category.service";

class CreateDocumentCategoryDto {
    @IsString()
    value!: string;

    @IsString()
    label!: string;

    @IsString()
    color!: string;
}

@Controller("document-categories")
export class DocumentCategoryController {
    constructor(private readonly documentCategoryService: DocumentCategoryService) {}

    @Get()
    async findAll(): Promise<DocumentCategory[]> {
        return this.documentCategoryService.findAll();
    }

    @Post()
    async create(@Body() dto: CreateDocumentCategoryDto): Promise<DocumentCategory> {
        return this.documentCategoryService.create({
            value: dto.value,
            label: dto.label,
            color: dto.color,
        });
    }

    @Delete(":id")
    async delete(@Param("id") id: string): Promise<void> {
        return this.documentCategoryService.delete(id);
    }
}
