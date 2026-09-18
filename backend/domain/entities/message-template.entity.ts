export interface TemplateVariable {
    key: string;
    type: "text" | "phone" | "select" | "date" | "number" | "textarea";
    label: string;
    placeholder?: string;
    required: boolean;
    optionType?: "custom" | "dataSource";
    options?: string[];
    dataSource?: string;
    fallback?: string;
    min?: number;
    max?: number;
}

export interface VariableValidationResult {
    valid: boolean;
    errors: string[];
}

export const MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES = {
    name: "템플릿 이름은 공백 이외의 문자를 포함해야 합니다.",
    content: "템플릿 내용은 공백 이외의 문자를 포함해야 합니다.",
} as const;

export const MESSAGE_TEMPLATE_REQUIRED_FIELD_MISSING_MESSAGES = {
    name: "템플릿 이름을 입력해주세요.",
    content: "템플릿 내용을 입력해주세요.",
} as const;

export interface MessageTemplateRequiredFieldInput {
    name?: unknown;
    content?: unknown;
}

export interface MessageTemplateRequiredFieldOptions {
    requireName?: boolean;
    requireContent?: boolean;
}

/**
 * Validate only fields present in an incoming write. Legacy rows may contain
 * blank values, so partial updates must not reject fields that were omitted.
 */
export function validateMessageTemplateRequiredFields(
    fields: MessageTemplateRequiredFieldInput,
    options: MessageTemplateRequiredFieldOptions = {},
): VariableValidationResult {
    const errors: string[] = [];
    const fieldRules = [
        {
            key: "name" as const,
            value: fields.name,
            required: options.requireName === true,
            missingMessage: MESSAGE_TEMPLATE_REQUIRED_FIELD_MISSING_MESSAGES.name,
            invalidMessage: MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES.name,
        },
        {
            key: "content" as const,
            value: fields.content,
            required: options.requireContent === true,
            missingMessage: MESSAGE_TEMPLATE_REQUIRED_FIELD_MISSING_MESSAGES.content,
            invalidMessage: MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES.content,
        },
    ];

    for (const rule of fieldRules) {
        if (rule.value === undefined) {
            if (rule.required) errors.push(rule.missingMessage);
            continue;
        }

        if (typeof rule.value !== "string" || !/\S/.test(rule.value)) {
            errors.push(rule.invalidMessage);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

interface CreateMessageTemplateProps {
    name: string;
    content: string;
    variables: TemplateVariable[];
}

interface UpdateMessageTemplateProps {
    name?: string;
    content?: string;
    variables?: TemplateVariable[];
}

export class MessageTemplateEntity {
    constructor(
        public readonly id: string,
        public name: string,
        public content: string,
        public variables: TemplateVariable[],
        public readonly createdAt: Date,
        public updatedAt: Date,
    ) {}

    update(props: UpdateMessageTemplateProps): void {
        if (props.name !== undefined) this.name = props.name;
        if (props.content !== undefined) this.content = props.content;
        if (props.variables !== undefined) this.variables = props.variables;
        this.updatedAt = new Date();
    }

    extractVariablesFromContent(): string[] {
        const regex = /\{\{([^}]+)\}\}/g;
        const matches = Array.from(this.content.matchAll(regex));
        return [...new Set(matches.map(m => m[1]?.trim() ?? "").filter(Boolean))];
    }

    validateVariables(): VariableValidationResult {
        const contentVars = this.extractVariablesFromContent();
        const definedKeys = new Set(this.variables.map(v => v.key));
        const errors: string[] = [];

        for (const varKey of contentVars) {
            if (!definedKeys.has(varKey)) {
                errors.push(`템플릿에 정의되지 않은 변수: {{${varKey}}}`);
            }
        }

        const contentVarsSet = new Set(contentVars);
        for (const variable of this.variables) {
            if (!contentVarsSet.has(variable.key)) {
                errors.push(`사용되지 않는 변수 정의: ${variable.key}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    getVariableCount(): number {
        return this.variables.length;
    }

    static create(props: CreateMessageTemplateProps): MessageTemplateEntity {
        const now = new Date();
        return new MessageTemplateEntity(
            "",
            props.name,
            props.content,
            props.variables,
            now,
            now,
        );
    }

    static reconstitute(
        id: string,
        name: string,
        content: string,
        variables: TemplateVariable[],
        createdAt: Date,
        updatedAt: Date,
    ): MessageTemplateEntity {
        return new MessageTemplateEntity(
            id,
            name,
            content,
            variables,
            createdAt,
            updatedAt,
        );
    }
}
