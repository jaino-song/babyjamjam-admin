import { Controller, Post, Body, Get, Query, Patch, Delete } from "@nestjs/common";
import { AreaTemplateService } from "application/services/area-template.service";

interface CreateAreaTemplateDto {
    area: string;
    templateId: string;
    templateName?: string | null;
}

interface UpdateAreaTemplateDto {
    templateId?: string;
    templateName?: string | null;
}

@Controller("area-templates")
export class AreaTemplateController {
    constructor(private readonly areaTemplateService: AreaTemplateService) {}

    @Post()
    create(@Body() dto: CreateAreaTemplateDto) {
        return this.areaTemplateService.create(dto);
    }

    @Get("area")
    findByArea(@Query("area") area: string) {
        return this.areaTemplateService.findByArea(area);
    }

    @Get()
    findAll() {
        return this.areaTemplateService.findAll();
    }

    @Patch()
    update(@Query("area") area: string, @Body() dto: UpdateAreaTemplateDto) {
        return this.areaTemplateService.update(area, dto);
    }

    @Delete()
    delete(@Query("area") area: string) {
        return this.areaTemplateService.delete(area);
    }
}
