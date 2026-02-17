export interface TemplateVariable {
    key: string;
    label: string;
    type: string;
    required: boolean;
}

export interface MessageTemplate {
    id: string;
    name: string;
    content: string;
    variables: TemplateVariable[];
    createdAt: string;
    updatedAt: string;
}

export interface PaginatedTemplates {
    data: MessageTemplate[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface CreateTemplateDto {
    name: string;
    content: string;
    variables: TemplateVariable[];
}

export interface UpdateTemplateDto {
    name: string;
    content: string;
    variables: TemplateVariable[];
}
