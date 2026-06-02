import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString } from "class-validator";
import { DocumentCategoryService, DocumentCategory } from "application/services/document-category.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";

class CreateDocumentCategoryDto {
    @IsString()
    value!: string;

    @IsString()
    label!: string;

    @IsString()
    color!: string;
}

@Controller("document-categories")
@UseGuards(JwtGuard, TenantGuard)
export class DocumentCategoryController {
    constructor(private readonly documentCategoryService: DocumentCategoryService) {}

    @Get()
    async findAll(@CurrentTenant() tenant: { branchId?: string }): Promise<DocumentCategory[]> {
        return this.documentCategoryService.findAll(tenant.branchId ?? "");
    }

    @Post()
    @UseGuards(OwnerOrAdminGuard)
    async create(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: CreateDocumentCategoryDto,
    ): Promise<DocumentCategory> {
        return this.documentCategoryService.create({
            branchId: tenant.branchId ?? "",
            value: dto.value,
            label: dto.label,
            color: dto.color,
        });
    }

    @Delete(":id")
    @UseGuards(OwnerOrAdminGuard)
    async delete(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
    ): Promise<void> {
        return this.documentCategoryService.delete(tenant.branchId ?? "", id);
    }
}
