import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { SystemTemplateWithRegistryDto } from "application/dto/system-template-with-registry.dto";
import { SystemTemplateService } from "application/services/system-template.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { PreviewTemplateDto, UpdateSystemTemplateDto, ValidateTemplateDto } from "interface/dto/system-template.dto";

@Controller("system-templates")
@UseGuards(JwtGuard)
export class SystemTemplateController {
    constructor(private readonly service: SystemTemplateService) {}

    @Get()
    getAll(): Promise<SystemTemplateWithRegistryDto[]> {
        return this.service.getAll();
    }

    @Get(":key")
    getByKey(@Param("key") key: string): Promise<SystemTemplateWithRegistryDto> {
        return this.service.getByKey(key);
    }

    @Put(":key")
    update(@Param("key") key: string, @Body() dto: UpdateSystemTemplateDto, @Req() req: any) {
        return this.service.update(key, dto.content, req.user.userId);
    }

    @Post(":key/validate")
    validate(@Param("key") key: string, @Body() dto: ValidateTemplateDto) {
        return this.service.validate(key, dto.content);
    }

    @Post(":key/preview")
    preview(@Param("key") key: string, @Body() dto: PreviewTemplateDto) {
        return this.service.preview(key, dto.data, dto.content);
    }

    @Get(":key/versions")
    async getVersions(@Param("key") key: string) {
        const versions = await this.service.getVersionHistory(key);
        return versions.map((version) => ({
            versionNumber: version.versionNumber,
            createdAt: version.createdAt,
            createdBy: version.createdBy,
        }));
    }

    @Get(":key/versions/:versionNumber")
    async getVersionContent(@Param("key") key: string, @Param("versionNumber") versionNumber: string) {
        const version = await this.service.getVersionContent(key, parseInt(versionNumber, 10));
        return {
            versionNumber: version.versionNumber,
            createdAt: version.createdAt,
            createdBy: version.createdBy,
            content: version.content,
        };
    }

    @Post(":key/rollback/:versionNumber")
    rollback(@Param("key") key: string, @Param("versionNumber") versionNumber: string, @Req() req: any) {
        return this.service.rollback(key, parseInt(versionNumber, 10), req.user.userId);
    }

    @Post(":key/reset")
    reset(@Param("key") key: string, @Req() req: any) {
        return this.service.resetToDefault(key, req.user.userId);
    }
}
