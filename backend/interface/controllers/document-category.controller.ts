import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString } from "class-validator";
import { DocumentCategoryService, DocumentCategory } from "application/services/document-category.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

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
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    async create(@Body() dto: CreateDocumentCategoryDto): Promise<DocumentCategory> {
        return this.documentCategoryService.create({
            value: dto.value,
            label: dto.label,
            color: dto.color,
        });
    }

    @Delete(":id")
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    async delete(@Param("id") id: string): Promise<void> {
        return this.documentCategoryService.delete(id);
    }
}
