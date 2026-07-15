import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { nanoid } from "nanoid";

export interface CreateFeedbackDto {
    sessionId: string;
    messageId: string;
    userId: string;
    type: "positive" | "negative";
    comment?: string;
}

@Injectable()
export class ChatFeedbackRepository {
    constructor(private prisma: PrismaService) {}

    async create(data: CreateFeedbackDto) {
        return this.prisma.chat_feedback.create({
            data: {
                id: nanoid(),
                sessionId: data.sessionId,
                messageId: data.messageId,
                userId: data.userId,
                type: data.type,
                comment: data.comment,
            },
            include: {
                chatSession: {
                    include: { messages: { orderBy: { timestamp: 'asc' } } },
                },
                chatMessage: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });
    }

    async findById(id: string) {
        return this.prisma.chat_feedback.findUnique({
            where: { id },
            include: {
                chatSession: {
                    include: { messages: { orderBy: { timestamp: 'asc' } } },
                },
                chatMessage: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });
    }

    async findBySession(sessionId: string) {
        return this.prisma.chat_feedback.findMany({
            where: { sessionId: sessionId },
            include: { chatMessage: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findManyWithPagination(params: {
        page: number;
        limit: number;
        type?: 'positive' | 'negative';
    }) {
        const { page, limit, type } = params;
        const skip = (page - 1) * limit;

        const where = type ? { type } : {};

        const [data, total] = await Promise.all([
            this.prisma.chat_feedback.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    chatMessage: true,
                },
            }),
            this.prisma.chat_feedback.count({ where }),
        ]);

        return { data, total };
    }

    async getStats() {
        const [positive, negative, total] = await Promise.all([
            this.prisma.chat_feedback.count({ where: { type: 'positive' } }),
            this.prisma.chat_feedback.count({ where: { type: 'negative' } }),
            this.prisma.chat_feedback.count(),
        ]);

        return { positive, negative, total };
    }
}
