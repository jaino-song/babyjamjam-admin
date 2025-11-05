import { Body, Controller, Delete, Get, Query, Patch, Post } from "@nestjs/common";
import { MessageService } from "application/services/message.service";
import { CreateMessageDto, UpdateMessageDto } from "interface/dto/message.dto";

@Controller("messages")
export class MessageController {
    constructor(private readonly messageService: MessageService) {}

    @Post()
    create(@Body() dto: CreateMessageDto) {
        return this.messageService.create(dto.title, dto.text);
    }

    @Get("id")
    findById(@Query("id") id: string) {
        return this.messageService.findById(Number(id));
    }

    @Patch()
    update(@Query("id") id: string, @Body() dto: UpdateMessageDto) {
        return this.messageService.update(Number(id), dto.title, dto.text);
    }

    @Delete()
    delete(@Query("id") id: string) {
        return this.messageService.delete(Number(id));
    }
}

