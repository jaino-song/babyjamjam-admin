export type VariableType = "text" | "phone" | "select" | "date" | "number" | "textarea";

export interface TemplateVariable {
    key: string;
    type: VariableType;
    label: string;
    placeholder?: string;
    required: boolean;
    optionType?: "custom" | "dataSource";
    options?: string[];
    dataSource?: string;
    min?: number;
    max?: number;
}

export interface MessageTemplate {
    id: string;
    name: string;
    content: string;
    variables: TemplateVariable[];
    createdAt: string;
    updatedAt: string;
}

export interface CreateMessageTemplateRequest {
    name: string;
    content: string;
    variables: TemplateVariable[];
}

export interface UpdateMessageTemplateRequest {
    name?: string;
    content?: string;
    variables?: TemplateVariable[];
}
