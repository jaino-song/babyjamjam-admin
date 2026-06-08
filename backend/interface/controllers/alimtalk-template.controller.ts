import { Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AlimtalkTemplateService } from "application/services/alimtalk-template.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { CreateAlimtalkTemplateDto } from "interface/dto/alimtalk-template.dto";

@Controller("alimtalk-templates")
@UseGuards(JwtGuard, TenantGuard)
export class AlimtalkTemplateController {
    constructor(private readonly alimtalkTemplateService: AlimtalkTemplateService) {}

    @Get()
    list() {
        return this.alimtalkTemplateService.list();
    }

    @Post()
    @UseInterceptors(FileInterceptor("image"))
    create(
        @Body() dto: CreateAlimtalkTemplateDto,
        @UploadedFile() image?: Express.Multer.File,
    ) {
        return this.alimtalkTemplateService.create(dto, image);
    }
}
