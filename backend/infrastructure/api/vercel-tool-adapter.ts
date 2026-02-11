import { z } from "zod";
import { tool } from "ai";
import type { FunctionDeclaration } from "./gemini-chat.gateway";

/**
 * Converts Gemini FunctionDeclaration format to Vercel AI SDK Tool format.
 *
 * This adapter allows reusing existing tool definitions without modifying them,
 * translating between:
 * - Gemini: { type: "string", description: "..." }
 * - Zod: z.string().describe("...")
 */

type GeminiPropertyType = {
    type: string;
    description: string;
    enum?: string[];
};

type GeminiProperties = Record<string, GeminiPropertyType>;

/**
 * Converts a single Gemini property type to a Zod schema.
 */
function convertPropertyToZod(property: GeminiPropertyType): z.ZodTypeAny {
    let schema: z.ZodTypeAny;

    switch (property.type) {
        case "string":
            if (property.enum && property.enum.length > 0) {
                // Zod enum requires at least one value
                schema = z.enum(property.enum as [string, ...string[]]);
            } else {
                schema = z.string();
            }
            break;
        case "number":
            schema = z.number();
            break;
        case "integer":
            schema = z.number().int();
            break;
        case "boolean":
            schema = z.boolean();
            break;
        case "array":
            // Default to array of strings if no items specified
            schema = z.array(z.string());
            break;
        case "object":
            // Default to record of string keys with unknown values
            schema = z.record(z.string(), z.unknown());
            break;
        default:
            schema = z.unknown();
    }

    // Add description if available
    if (property.description) {
        schema = schema.describe(property.description);
    }

    return schema;
}

/**
 * Converts Gemini parameters to a Zod object schema.
 */
function convertParametersToZodSchema(
    properties: GeminiProperties,
    required: string[] = []
) {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, value] of Object.entries(properties)) {
        let fieldSchema = convertPropertyToZod(value);

        // Make optional if not in required array
        if (!required.includes(key)) {
            fieldSchema = fieldSchema.optional();
        }

        shape[key] = fieldSchema;
    }

    return z.object(shape);
}

/**
 * Converts a single FunctionDeclaration to a Vercel AI SDK tool.
 * Note: This creates tools WITHOUT execute functions - execution is handled separately.
 */
export function convertToVercelTool(declaration: FunctionDeclaration) {
    const schema = convertParametersToZodSchema(
        declaration.parameters.properties,
        declaration.parameters.required || []
    );

    return tool({
        description: declaration.description,
        inputSchema: schema,
        // No execute function - we handle tool execution in ToolExecutorService
    });
}

/**
 * Converts all FunctionDeclarations to a Vercel AI SDK tools object.
 */
export function convertToVercelTools(
    declarations: FunctionDeclaration[]
): Record<string, ReturnType<typeof convertToVercelTool>> {
    const tools: Record<string, ReturnType<typeof convertToVercelTool>> = {};

    for (const declaration of declarations) {
        tools[declaration.name] = convertToVercelTool(declaration);
    }

    return tools;
}
