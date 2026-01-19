import { IsString, IsOptional, IsNotEmpty } from "class-validator";

export class ChatStreamDto {
    @IsOptional()
    @IsString()
    sessionId?: string;

    @IsNotEmpty()
    @IsString()
    message!: string;
}

export class SessionIdParamDto {
    @IsNotEmpty()
    @IsString()
    id!: string;
}

export interface ChatMessageResponse {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

export interface SessionResponse {
    id: string;
    userId: string;
    messages: ChatMessageResponse[];
    createdAt: string;
    expiresAt: string;
}
