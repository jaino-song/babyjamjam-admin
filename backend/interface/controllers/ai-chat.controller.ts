import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    Req,
    Res,
    UseGuards,
    HttpStatus,
    NotFoundException,
    Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AIChatService } from "application/services/ai-chat.service";
import { ChatStreamDto, SessionIdParamDto, SessionResponse } from "interface/dto/ai-chat.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

interface JwtUser {
    userId: string;
    role: string;
}

@Controller("ai/chat")
@UseGuards(JwtGuard)
export class AIChatController {
    private readonly logger = new Logger(AIChatController.name);

    constructor(private readonly aiChatService: AIChatService) {}

    @Post("stream")
    async streamChat(
        @Body() dto: ChatStreamDto,
        @Req() req: Request,
        @Res() res: Response,
    ): Promise<void> {
        const user = req.user as JwtUser;
        const userId = user.userId;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        try {
            const stream = this.aiChatService.chatStream(
                dto.sessionId,
                userId,
                dto.message,
            );

            for await (const chunk of stream) {
                const eventType = chunk.type === "error" ? "error" : "message";
                res.write(`event: ${eventType}\ndata: ${JSON.stringify(chunk)}\n\n`);
            }

            res.end();
        } catch (error) {
            this.logger.error(`Stream error: ${error}`);
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`);
            res.end();
        }
    }

    @Get("sessions/:id")
    async getSession(
        @Param() params: SessionIdParamDto,
        @Req() req: Request,
    ): Promise<SessionResponse> {
        const user = req.user as JwtUser;
        const session = await this.aiChatService.getSession(params.id);

        if (!session) {
            throw new NotFoundException("Session not found or expired");
        }

        if (session.userId !== user.userId) {
            throw new NotFoundException("Session not found");
        }

        return {
            id: session.id,
            userId: session.userId,
            messages: session.messages.map((m) => ({
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
            })),
            createdAt: session.createdAt.toISOString(),
            expiresAt: session.expiresAt.toISOString(),
        };
    }

    @Delete("sessions/:id")
    async deleteSession(
        @Param() params: SessionIdParamDto,
        @Req() req: Request,
        @Res() res: Response,
    ): Promise<void> {
        const user = req.user as JwtUser;
        const session = await this.aiChatService.getSession(params.id);

        if (!session) {
            throw new NotFoundException("Session not found");
        }

        if (session.userId !== user.userId) {
            throw new NotFoundException("Session not found");
        }

        await this.aiChatService.deleteSession(params.id);
        res.status(HttpStatus.NO_CONTENT).send();
    }
}
