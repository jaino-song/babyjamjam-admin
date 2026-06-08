import type {
    CreateMessageTemplateRequest,
    MessageTemplate,
    MessageTemplateListResponse,
    MessageTemplateVariable,
    UpdateMessageTemplateRequest,
} from "@babyjamjam/shared/types/message";

export type TemplateVariable = MessageTemplateVariable;

export type {
    MessageTemplate,
};

// Legacy alias kept locally so feature imports stay stable while the real
// backend contract remains an array response.
export type PaginatedTemplates = MessageTemplateListResponse;
export type CreateTemplateDto = CreateMessageTemplateRequest;
export type UpdateTemplateDto = UpdateMessageTemplateRequest;
