import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
    NotFoundException,
    ParseIntPipe,
    DefaultValuePipe,
} from '@nestjs/common';
import { JwtGuard } from 'infrastructure/auth/jwt.guard';
import { OwnerOrAdminGuard } from 'infrastructure/auth/owner-or-admin.guard';
import { ChatFeedbackRepository } from 'infrastructure/database/repositories/chat-feedback.repository';
import {
    PaginatedFeedbackDto,
    FeedbackStatsDto,
    FeedbackDetailDto,
    FeedbackItemDto,
} from 'interface/dto/admin-feedback.dto';

@Controller('admin/feedback')
@UseGuards(JwtGuard, OwnerOrAdminGuard)
export class AdminFeedbackController {
    constructor(
        private readonly feedbackRepository: ChatFeedbackRepository,
    ) {}

    @Get()
    async listFeedback(
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Query('type') type?: 'positive' | 'negative',
    ): Promise<PaginatedFeedbackDto> {
        const { data, total } = await this.feedbackRepository.findManyWithPagination({
            page,
            limit,
            type,
        });

        const feedbackItems: FeedbackItemDto[] = data.map((feedback: any) => ({
            id: feedback.id,
            type: feedback.type as 'positive' | 'negative',
            comment: feedback.comment,
            createdAt: feedback.createdAt,
            user: {
                id: feedback.user.id,
                name: feedback.user.name,
                email: feedback.user.email,
            },
            message: {
                id: feedback.chatMessage.id,
                content: feedback.chatMessage.content,
                role: feedback.chatMessage.role,
                timestamp: feedback.chatMessage.timestamp,
            },
        }));

        const totalPages = Math.ceil(total / limit);

        return {
            data: feedbackItems,
            total,
            page,
            limit,
            totalPages,
        };
    }

    @Get('stats')
    async getStats(): Promise<FeedbackStatsDto> {
        return this.feedbackRepository.getStats();
    }

    @Get(':id')
    async getFeedbackDetail(@Param('id') id: string): Promise<FeedbackDetailDto> {
        const feedback = await this.feedbackRepository.findById(id);

        if (!feedback) {
            throw new NotFoundException('Feedback not found');
        }

        const f = feedback as any;
        return {
            id: f.id,
            type: f.type as 'positive' | 'negative',
            comment: f.comment,
            createdAt: f.createdAt,
            user: {
                id: f.user.id,
                name: f.user.name,
                email: f.user.email,
            },
            message: {
                id: f.chatMessage.id,
                content: f.chatMessage.content,
                role: f.chatMessage.role,
                timestamp: f.chatMessage.timestamp,
            },
            session: {
                id: f.chatSession.id,
                messages: f.chatSession.messages.map((msg: any) => ({
                    id: msg.id,
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                })),
            },
        };
    }
}
