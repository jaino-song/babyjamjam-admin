import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { MessageTemplateService } from "application/services/message-template.service";
import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from "interface/dto/message-template.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

@Controller("message-templates")
@UseGuards(JwtGuard)
export class MessageTemplateController {
    constructor(private readonly messageTemplateService: MessageTemplateService) {}

    @Post()
    create(@Body() dto: CreateMessageTemplateDto) {
        return this.messageTemplateService.create({
            name: dto.name,
            content: dto.content,
            variables: dto.variables,
        });
    }

    @Get()
    findAll() {
        return this.messageTemplateService.findAll();
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.messageTemplateService.findById(id);
    }

    @Patch(":id")
    update(@Param("id") id: string, @Body() dto: UpdateMessageTemplateDto) {
        return this.messageTemplateService.update(id, {
            name: dto.name,
            content: dto.content,
            variables: dto.variables,
        });
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.messageTemplateService.delete(id);
    }
}
